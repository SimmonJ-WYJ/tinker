export interface ProfileNameSaveResolution {
  nextName: string
  shouldSave: boolean
}

export function resolveProfileNameSave(
  input: string,
  currentName: string
): ProfileNameSaveResolution {
  const trimmed = input.trim()
  if (!trimmed) {
    return {
      nextName: currentName,
      shouldSave: false,
    }
  }

  return {
    nextName: trimmed,
    shouldSave: trimmed !== currentName,
  }
}
