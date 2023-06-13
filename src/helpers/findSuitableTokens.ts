import {
    Configuration,
    CreateCompletionResponseUsage,
    OpenAIApi,
  } from 'openai';
import { useAppState } from "../state/store";
import { formatPrompt } from "./determineNextAction";


const textProcessSystemMessage = `
You are GPT-3.5, an advanced AI developed by OpenAI. 
Your task is to scrutinize the given text data from a webpage, focusing particularly on the context of creating a tweet with AI assistance. 
Extract only the most pertinent words or phrases directly or indirectly related to this specific user's request. 
These extracted elements will inform what actions need to be carried out on the webpage to fulfill the request. 
Aim for precision, relevance, and context-specific selections. The output should be a JSON array of these words or phrases, wrapped within <Data> tags.
`;


export async function findSuitableTokens(
    webContent: string, userRequest: string
): Promise<string[] | null> {


    const model = useAppState.getState().settings.selectedModel;


  // const processedDom = processDom(simplifiedDOM);

  // console.log(simplifiedDOM);
  // console.log(processedDom);

  const key = useAppState.getState().settings.openAIKey;
  if (!key) {
    return null;
  }

  const openai = new OpenAIApi(
    new Configuration({
      apiKey: key,
    })
  );

  const prompt = `
  Here is the user's request and the text data from the webpage:

User's Request: ${userRequest}

Text Data from Webpage: ${webContent}

Please conduct a precise, context-specific analysis of the given text and extract only the words or phrases most relevant to creating a tweet with AI assistance. Present the results in the required format.
  `

  const completion = await openai.createChatCompletion({
    model: model,
    messages: [
      {
        role: 'system',
        content: textProcessSystemMessage,
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 500,
    temperature: 0,
    stop: ['</Action>'],
  });

    return [];
}