export type AiProvider='openrouter'|'openai'|'claude';
export type AiStatus={selected:AiProvider;canRemember:boolean;broken:boolean;warning:string;profiles:Record<AiProvider,{model:string;hasKey:boolean;remember:boolean}>};
export type AiExcerpt={page:number;text:string};
export type AiRequest={id:string;provider:AiProvider;model:string;language?:'es'|'en';question:string;partial:boolean;excerpts:AiExcerpt[];history:{role:'user'|'assistant';content:string}[]};
export type AiAnswer={answer:string;citations:{page:number;quote:string}[];warning:string;provider:AiProvider;model:string;tokens:{input:number|null;output:number|null}};
export const aiProviders:Record<AiProvider,string>={openrouter:'OpenRouter',openai:'OpenAI',claude:'Claude (Anthropic)'};
