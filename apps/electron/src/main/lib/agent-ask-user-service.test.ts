import { expect, test } from 'bun:test'
import { normalizeAskUserInput } from './agent-ask-user-service'

test('normalizeAskUserInput 保留标准 questions 数组输入', () => {
  const input = {
    questions: [
      {
        question: 'Which model should we use?',
        header: 'Model',
        options: [
          { label: 'A', description: 'Use A' },
          { label: 'B', description: 'Use B' },
        ],
      },
    ],
  }

  expect(normalizeAskUserInput(input)).toEqual(input)
})

test('normalizeAskUserInput 将单题输入包装成 questions 数组', () => {
  const input = {
    question: 'Which model should we use?',
    header: 'Model',
    options: [
      { label: 'A', description: 'Use A' },
      { label: 'B', description: 'Use B' },
    ],
    multiSelect: false,
  }

  expect(normalizeAskUserInput(input)).toEqual({
    ...input,
    questions: [
      {
        question: input.question,
        header: input.header,
        options: input.options,
        multiSelect: input.multiSelect,
      },
    ],
  })
})

