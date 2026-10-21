/**
 * Reading a file address without the harness helper.
 *
 * `fileAddressFor` lives in `@deepseek-ai/dsh-util-workspace-path`, which is not
 * a boot-graph row and not a platform seed word, so a third-party bundle cannot
 * require it. The shipped plugins inline the same few lines; this is that copy,
 * decode-only.
 *
 * Grammar (`dsh-resource://file/…`):
 *   session/<sessionId>/<path>   the authorizing Session plus a relative or
 *                                absolute path; `:` stays literal, so a Windows
 *                                drive letter reads `D:`
 *   absolute/<path>              no authority; the Host refuses it
 */

/** Address prefix shared by every file resource. */
const PREFIX = 'dsh-resource://file/';

/**
 * Decode one already-split address segment.
 * @param segment - a percent-encoded path segment.
 * @returns the decoded segment, or the raw text when it is not valid encoding.
 */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The workspace path a file address names.
 * @param address - a `dsh-resource://file/…` address.
 * @returns the decoded path, or `undefined` for any other address.
 */
export function pathOfFileAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(PREFIX)) return undefined;
  const segments = address.slice(PREFIX.length).split('/');
  const scope = segments[0];
  const tail = scope === 'session' ? segments.slice(2) : scope === 'absolute' ? segments.slice(1) : undefined;
  if (tail === undefined) return undefined;
  const path = tail.map(decodeSegment).join('/');
  return path === '' ? undefined : path;
}

/**
 * The final path segment, used for the status bar and the suffix lookup.
 * @param path - a decoded path.
 * @returns the last segment, or the input when it has no separator.
 */
export function fileNameOf(path) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash < 0 ? path : path.slice(slash + 1);
}
