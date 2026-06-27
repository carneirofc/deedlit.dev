export function toggleStringInList(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
}
