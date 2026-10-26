/** A bounded linear diff; preserves exact text and highlights the changed middle. */
export function compareVersionText(previous: string, current: string) {
  const left = previous.split(/(\s+)/),
    right = current.split(/(\s+)/);
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  )
    start++;
  let end = 0;
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  )
    end++;
  return {
    prefix: left.slice(0, start).join(""),
    removed: left.slice(start, end ? left.length - end : undefined).join(""),
    added: right.slice(start, end ? right.length - end : undefined).join(""),
    suffix: end ? left.slice(left.length - end).join("") : "",
    changed: previous !== current,
  };
}
