// Source scanning for the one guard that reads the tree instead of trusting a
// hand-maintained list: the identity-injection guard in `test/git.test.mjs`.
//
// It lived inline there until `20261021-223918` needed a second reader and a
// second copy would have been the duplication that guard exists to prevent.
// That second reader — a seat inventory swept from the tree — was withdrawn:
// two independent reviews demonstrated ten classes of silent miss across a
// text version and an AST version, because "this module performs operation X"
// is not decidable from syntax. What is left here is the text reader the
// identity guard has always used.

// Extracts the full text of every `<name>(` call in `source`, balancing
// parentheses so a call spread over several lines is read whole. Returns
// `{ start, end, line, text }` per call, so a violation can be reported where
// it lives.
export function callsTo(source, name) {
  const calls = [];
  const opener = `${name}(`;
  for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + 1)) {
    // `setStatus(` must not match `unsetStatus(`: the opener is a suffix of the
    // longer name, and `indexOf` does not know about identifier boundaries.
    if (at > 0 && /[\w$]/.test(source[at - 1])) continue;
    let depth = 0;
    let end = at + opener.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({
      start: at,
      end,
      line: source.slice(0, at).split('\n').length,
      text: source.slice(at, end + 1),
    });
  }
  return calls;
}
