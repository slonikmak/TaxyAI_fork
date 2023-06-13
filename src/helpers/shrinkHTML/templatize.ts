import _ from 'lodash';
import { range } from 'lodash';

type JsonNode =
  | {
      type: 'ELEMENT';
      tagName: string;
      attributes: { [key: string]: string };
      children: JsonNode[];
      templateHash: string;
      templateValues: string[];
      depth: number;
    }
  | {
      type: 'TEXT';
      content: string;
      templateHash: string;
      templateValues: [string];
      depth: 0;
    };

type PossibleTemplate = {
  hash: string;
  // definitionLength: string;
  nodes: JsonNode[];
  depth: number;
};

type OptimizedTemplate = PossibleTemplate & {
  label?: string;
  template?: string;
  valuesToInline: Set<number>;
};

type PossibleTemplates = Record<string, PossibleTemplate>;

export function findPotentialTemplates(
  node: Node,
  possibleTemplates: PossibleTemplates
): JsonNode | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const attributes: { [key: string]: string } = {};

    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      attributes[attr.name] = attr.value;
    }

    const children: JsonNode[] = [];

    for (const childNode of element.childNodes) {
      const childJson = findPotentialTemplates(childNode, possibleTemplates);
      if (childJson) {
        children.push(childJson);
      }
    }

    const depth = children.reduce((max, c) => Math.max(max, c.depth), 0) + 1;

    const templateHash = `${element.tagName}#${Object.keys(
      attributes
    ).sort()}#${children.map((c) => c.templateHash).join('|')}`;

    const templateValues = Object.values(attributes).concat(
      children.flatMap((c) => c.templateValues)
    );

    const jsonNode: JsonNode = {
      type: 'ELEMENT',
      tagName: element.tagName,
      attributes,
      children,
      templateHash,
      templateValues,
      depth,
    };

    if (possibleTemplates[templateHash]) {
      if (possibleTemplates[templateHash].depth !== depth) {
        throw new Error(`Template depth mismatch for template ${templateHash}`);
      }
      possibleTemplates[templateHash].nodes.push(jsonNode);
    } else {
      possibleTemplates[templateHash] = {
        hash: templateHash,
        nodes: [jsonNode],
        depth,
      };
    }

    return jsonNode;
  } else if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (text && text.trim()) {
      return {
        type: 'TEXT',
        content: text,
        templateHash: `TEXT`,
        templateValues: [text],
        depth: 0,
      };
    }
  }

  return null;
}

const optimizeTemplate = (template: PossibleTemplate): OptimizedTemplate => {
  // Find template values that are the same for all nodes
  const valuesToInline = range(template.nodes[0].templateValues.length).filter(
    (i) => {
      const values = template.nodes.map((n) => n.templateValues[i]);
      return values.every((v) => v === values[0]);
    }
  );

  return {
    ...template,
    valuesToInline: new Set(valuesToInline),
    // template: optimizedTemplate,
  };
};

function chooseTemplates(
  templates: Record<string, OptimizedTemplate>
): Record<string, OptimizedTemplate> {
  const chosenTemplates: Record<string, OptimizedTemplate> = {};
  const consumedTemplateCounts: Record<string, number> = {};

  for (const template of Object.values(templates).sort((t) => -t.depth)) {
    // If the template isn't used in at least 3 places, don't bother
    if (
      template.nodes.length - (consumedTemplateCounts[template.hash] ?? 0) <
        3 ||
      template.depth < 3
    ) {
      continue;
    }

    template.label = `T${Object.keys(chosenTemplates).length + 1}`;
    const serialized = createTemplateTree(
      template.nodes[0],
      chosenTemplates,
      template
    );
    template.template = serialized.template;
    chosenTemplates[template.hash] = template;
    serialized.consumedTemplates.forEach((t) => {
      consumedTemplateCounts[t] =
        (consumedTemplateCounts[t] ?? 0) + template.nodes.length;
    });
  }

  return chosenTemplates;
}

function getPlaceholder(
  template: OptimizedTemplate,
  valueIndex: number
): string {
  // valueIndex plus one minus the number of values below it that are inlined
  const placeholderIndex =
    valueIndex +
    1 -
    Array.from(template.valuesToInline).filter((i) => i < valueIndex).length;
  return `$${placeholderIndex}`;
}

function createTemplateTree(
  node: JsonNode,
  templates: Record<string, OptimizedTemplate>,
  renderForTemplate: OptimizedTemplate,
  currentValueIndex = 0
): { template: string; valueIndex: number; consumedTemplates: string[] } {
  if (node.type === 'TEXT') {
    if (renderForTemplate.valuesToInline.has(currentValueIndex)) {
      return {
        template: node.content,
        valueIndex: currentValueIndex + 1,
        consumedTemplates: [node.templateHash],
      };
    } else {
      return {
        template: getPlaceholder(renderForTemplate, currentValueIndex),
        valueIndex: currentValueIndex + 1,
        consumedTemplates: [node.templateHash],
      };
    }
  }

  let updatedValueIndex = currentValueIndex;
  const consumedTemplates = [node.templateHash];

  const attrs = Object.entries(node.attributes)
    .map(([k, v], i) => {
      if (renderForTemplate.valuesToInline.has(updatedValueIndex + i)) {
        return ` ${k}="${v}"`;
      } else {
        return ` ${k}=${getPlaceholder(
          renderForTemplate,
          updatedValueIndex + i
        )}`;
      }
    })
    .join('');

  updatedValueIndex += Object.keys(node.attributes).length;

  const children: string[] = [];
  for (const child of node.children) {
    const childTemplate = createTemplateTree(
      child,
      templates,
      renderForTemplate,
      updatedValueIndex
    );
    children.push(childTemplate.template);
    updatedValueIndex = childTemplate.valueIndex;
    consumedTemplates.push(...childTemplate.consumedTemplates);
  }

  const isSelfClosing = node.children.length === 0;

  return {
    template: `<${node.tagName.toLowerCase()}${attrs}${
      isSelfClosing
        ? '/>'
        : `>${children.join('')}</${node.tagName.toLowerCase()}>`
    }`,
    valueIndex: updatedValueIndex,
    consumedTemplates,
  };
}

function isStringANumber(str: string): boolean {
  return !isNaN(parseFloat(str)) && isFinite(str as any);
}

function serializeTree(
  node: JsonNode,
  templates: Record<string, OptimizedTemplate>
): string {
  if (node.type === 'TEXT') {
    return node.content;
  }

  // Check if the node's templateHash matches one of the chosen templates
  if (node.templateHash in templates) {
    const template = templates[node.templateHash];

    return `{${template.label}(${node.templateValues
      .filter((v, i) => !template.valuesToInline.has(i))
      .map((v) => (isStringANumber(v) ? v : JSON.stringify(v)))
      .join(',')})}`;
  }

  const attrs = Object.entries(node.attributes)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');

  const children = node.children
    .map((child) => serializeTree(child, templates))
    .join('');

  const isSelfClosing = node.children.length === 0;

  return `<${node.tagName.toLowerCase()}${attrs}${
    isSelfClosing ? '/>' : `>${children}</${node.tagName.toLowerCase()}>`
  }`;
}

export default function templatize(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.documentElement;

  const possibleTemplates: Record<string, PossibleTemplate> = {};

  const tree = findPotentialTemplates(root, possibleTemplates);

  if (!tree) return [html];

  const optimizedTemplates = Object.values(possibleTemplates).reduce(
    (acc, template) => {
      const optimized = optimizeTemplate(template);
      return {
        ...acc,
        [optimized.hash]: optimized,
      };
    },
    {}
  );

  // Choose which templates to apply
  const chosenTemplates = chooseTemplates(optimizedTemplates);

  const prepared = prepareTemplate(tree);
  const textData =  _.uniq(getTextData(prepared));


  const printedTemplates = Object.values(chosenTemplates)
    .map((t) => `${t.label}: ${t.template}`)
    .join('\n');

  // Apply chosen templates to the tree
  const templatizedTree = serializeTree(tree, chosenTemplates);

  //return printedTemplates + '\n\n' + templatizedTree;
  return [JSON.stringify(prepared), JSON.stringify(textData)];
}

const skipedTags = ["div", "a", "span", "h1", "h2", "img", "svg", "nav", "header", "table", "tr", "td", "section", "article", "body", "heading"]

export function getTextData(node: any[]):  string[] {

  let textArray: string[] = [];

  if (Array.isArray(node[0])) {
    node.forEach(n => {
      textArray = textArray.concat(getTextData(n))
    })
  } else {
    node.forEach(n => {
      if (typeof n == 'string' && !skipedTags.includes(n)) {
        textArray.push(n);
      } else if (Array.isArray(n)) {
        textArray = textArray.concat(getTextData(n))
      }
    })
  } 

  return textArray;

}

const possibleAttrs = ['id', 'aria-label', 'role', 'title', 'type'];

function prepareTemplate(node: JsonNode): any {


  if (node.type === 'TEXT') {    
    let text = node.content.replaceAll("\\n", "").replace(/\s+/g, ' ').trim();

    //temporary reduce big text
    return text.substring(0, 20);

  }

  if (node.tagName == 'HTML') {
    return prepareTemplate(node.children[1])
  }

  if (node.tagName.toLowerCase() == 'SVG') return null;


  const elem: any[] = [];

  elem.push(node.tagName.toLowerCase());

  const hasId = node.attributes.id;

  if (hasId) {
    elem.push(parseInt(node.attributes.id));
  }

  Object.entries(node.attributes)
    .forEach(([k, v]) => {
      if (k != 'id' && possibleAttrs.includes(k)) {
        elem.push(v);
      }
      
    });

  let children = node.children.map(child => prepareTemplate(child)).filter(el => el != null);

  if (children.length > 0) {
    if (children.length == 1 && typeof children[0] === 'string') {

      const contained = elem.filter(e => typeof e == 'string').filter(e => e.includes(children[0])).length;

      if (contained == 0) {
        elem.push(children[0])
      }
    } else {

      //flat 'span' inside 'a'
      if (elem[0] == 'a') {
        children = children.map(child => {
          if (Array.isArray(child)) {
            if (child[0] == 'span' && typeof _.last(child) == 'string') {
              return _.last(child);
            }
            return child;
          }
          return child;
        });
      }

      //join children if all of them is string
      // children = children.map(child => {
      //   if (Array.isArray(child) && child.every(item => typeof item === 'string')) {
      //     return [...new Set(child)].join(" ");
      //   } else return child;
      // })

      if (children.every(item => typeof item === 'string')) {
        elem.push(children.join(" "));
      } else {
        elem.push(children);
      }
      
    }   
  }

  // if ((elem[0] == 'DIV' || elem[0] == 'SPAN') && elem.length == 2) {
  //   if ( !Array.isArray(elem[1])) {
  //     return null;
  //   }
  // }

  if (elem.length == 2 && hasId) {
    return null;
  }

  // if (elem[0] == 'a') {
  //   const lastlem = elem[elem.length - 1];
  //   if (Array.isArray(lastlem) && lastlem[0] == 'span') {

  //   } 
  // }


  if (elem.filter(el=> typeof el == 'string' && el.toLowerCase().includes('footer')).length > 0) return null;

  const uniq = _.uniq(elem);

  if ((uniq[0] == 'div' || uniq[0] == 'span') && uniq.length == 3 && Array.isArray(uniq[2])) {
    if (Array.isArray(uniq[2]) && uniq[2].length == 1) {
      return uniq[2][0];
    } else {
      return uniq[2];
    }
  } else return uniq;

}
