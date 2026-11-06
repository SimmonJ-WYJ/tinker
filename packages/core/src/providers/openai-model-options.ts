/** OpenAI 已知推理模型的参数兼容策略；未知中转站模型保留传统字段。 */
export function usesCompletionTokenLimit(model: string): boolean {
  const name = model.toLowerCase().split('/').at(-1) ?? model
  return /^(?:o[134](?:-|$)|gpt-5(?:[.-]|$))/.test(name)
}
export function openAIOutputLimit(model: string, tokens: number): { max_tokens?: number; max_completion_tokens?: number } {
  return usesCompletionTokenLimit(model) ? { max_completion_tokens: tokens } : { max_tokens: tokens }
}
