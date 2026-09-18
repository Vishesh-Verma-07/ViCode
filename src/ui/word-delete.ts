export function deletePreviousWord(text: string): string {
  return text.replace(/\s*\S+\s*$/, "")
}