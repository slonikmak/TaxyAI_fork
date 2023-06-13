
export function processDom(domstring: string) {
  const parser = new DOMParser();

// Use DOMParser to parse the HTML string into a document
  const doc = parser.parseFromString(domstring, 'text/html');
  const json = Array.from(doc.body.children).map((el) => {
    return elementToJsonArray(el);
  });

  return JSON.stringify(json);
}


const possibleAttrs = ['id', 'aria-label', 'role', 'title', 'type'];

const elementToJsonArray = (element: Element) => {
  const json: any = [];

  // Skip 'svg' elements
  if (element.tagName.toLowerCase() === 'svg') {
    return json;
  }


  //skip elements without children and wich has no attributes except 'id'
  if (element.children.length == 0 && element.attributes.length == 1 && element.id) {
    
    return json;
  }



  const content: any = (element.tagName.toLowerCase() !== 'textarea') ? element.textContent?.trim() : '';
  const attributes: any = {};

  if (element.hasAttributes()) {
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes[i];
      if (possibleAttrs.includes(attribute.name)) {
        attributes[attribute.name] = attribute.value;
      }
    }
  }

  // Add tag name as the first element
  json.push(element.tagName.toLowerCase());

  // Add id attribute if it exists
  if (attributes.id) {
    json.push(attributes.id);
  }

  // Add other attributes
  for (const attr in attributes) {
    if (attr !== 'id') {
      json.push(attributes[attr]);
    }
  }

  // Add content or children elements if they exist
  if (element.children.length > 0) {
    const childrenJson: Array<any> = Array.from(element.children).map((el) => elementToJsonArray(el));
    if (childrenJson.length > 0 && childrenJson[0].length > 0) {
      if(childrenJson.length == 1) {
        return childrenJson[0];
      }
      json.push(childrenJson);

    }
  } else if (content !== '') {
    json.push(content);
  }

  return json;
};