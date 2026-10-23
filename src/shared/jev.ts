export type JevChoiceQuestion = {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

export type JevScoreQuestion = {
  type: 'score'
  instructions: string
  criteria: string[]
}

export type JevNoulQuestion = {
  type: 'noul'
  instructions: string
  criteria: { true: string; false: string }
}

export type JevQuestions = Record<string, JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion>

export type JevChoiceAnswer = {
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export type JevScoreAnswer = {
  type: 'score'
  score: number
  confidence: number
  legend: Record<string, string>
  probabilities: Record<string, number>
}

export type JevNoulAnswer = { type: 'noul'; noul: number }

export type JevAnswers = Record<string, JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer>

export type JevResponse = { model: string; answers: JevAnswers; latencyMs: number }

export type JevStatus = { configured: boolean; host: 'typesafe' | 'jev-agent' | null }

export type TranscriberStatus = { state: 'idle' | 'loading' | 'ready' | 'error'; model: string; error?: string }
