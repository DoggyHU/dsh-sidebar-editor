/**
 * Host half of dsh-sidebar-milkdown.
 *
 * The visible feature (a ProseMirror/Milkdown Markdown editor registered as a
 * document-preview renderer) lives in the browser half. This half exists for two
 * reasons:
 *
 *  1. A package is only scanned for a browser half when it is mounted as a host
 *     row, so this row makes `lib/client.js` discoverable.
 *  2. Saving a file needs a host: the official workspace-files Remote is
 *     read-only by contract ("The service exposes no mutation operation"), so the
 *     read and write path for the editor is ours. It rides a Connection RPC
 *     channel (`ctx.connection.rpc.handle`) rather than a raw `/api/...` route on
 *     purpose: an exact `/api/...` registration wins the webserver's
 *     exact-then-longest-prefix match over Connection's `/api` prefix route and
 *     would therefore bypass the Host/Origin trust fence and browser
 *     authentication. A channel registered through Connection runs `admit()`
 *     before the handler, so every call below is a peer-authenticated operator
 *     request.
 *
 * Writing goes through the official filesystem service (`ctx.fs`), which owns the
 * atomic commit, the per-target lock and the version guard:
 *
 *   fs.writeText(target, text, { kind: 'replaceIfVersion', version: base })
 *
 * A mismatch raises `FS_STALE_VERSION`; the handler answers with a `conflict`
 * result carrying the current bytes, so the browser can offer overwrite or reload
 * instead of silently clobbering someone else's edit.
 *
 * Only `connection` is injected: `fs` is read lazily per request, so a profile
 * without a filesystem service still mounts the plugin and answers `probe` with
 * `fs.present: false` instead of staying dark.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** Exact Fetch routes this plugin owns; each must sit under `/api`. */
const ROUTE_PREFIX = '/api/dsh-sidebar-milkdown';
/** Plugin version, mirrored into `ping` so the browser half can report it. */
const VERSION = '0.3.0';
/** Where the browser half's self-check lands, so a developer can read it from disk. */
const REPORT_PATH =
  process.env.DSH_SIDEBAR_MILKDOWN_REPORT ?? join(tmpdir(), 'dsh-sidebar-milkdown-report.json');
/** Load-time breadcrumb trail; the file that made this plugin's one hard bug visible. */
const DIAG_PATH = process.env.DSH_SIDEBAR_MILKDOWN_DIAG ?? join(tmpdir(), 'dsh-sidebar-milkdown-host.log');
/** Largest file this editor will open or save, in UTF-8 bytes. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Byte-order mark the editor keeps out of its buffer but restores on save. */
const BOM = '\uFEFF';

/**
 * Append one line to the host half's breadcrumb trail.
 *
 * A plugin's `apply` can fail in ways that leave no trace: cordis drops the child
 * fiber, the loader still reports the plugin active, and the page only sees 405.
 * This file is the difference between "it does not work" and a named cause.
 *
 * The executable is recorded because this file is shared with anyone running a
 * throwaway script against the same host half — a `.js` probe under plain `node`
 * writes here too, and a reader must be able to tell those lines from the app's.
 * @param line - what happened.
 */
function diagnose(line) {
  try {
    appendFileSync(DIAG_PATH, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    /* diagnostics must never break the plugin */
  }
}

diagnose(`module loaded (v${VERSION}, pid ${process.pid}, exec ${basename(process.execPath)})`);

export const name = 'dsh-sidebar-milkdown';
/** The authenticated RPC carrier this plugin's channel is served over. */
export const inject = ['connection'];

/** Machine-readable failure codes this channel answers with. */
const CODES = {
  badRequest: 'bad-request',
  unsupportedAddress: 'unsupported-address',
  unknownSession: 'unknown-session',
  outsideWorkspace: 'outside-workspace',
  notFound: 'not-found',
  notRegularFile: 'not-regular-file',
  notText: 'not-text',
  tooLarge: 'too-large',
  forbidden: 'forbidden',
  sandboxDenied: 'sandbox-denied',
  unavailable: 'unavailable',
};

/**
 * Describe every host service the save path needs.
 *
 * Used by the `probe` endpoint so a running deployment can be checked without
 * guessing whether `fs` and the session lookup are actually mounted.
 * @param ctx - host plugin context.
 * @returns a JSON-safe capability report.
 */
function probeServices(ctx) {
  const shape = (value, methods) => {
    if (value === undefined || value === null) return { present: false };
    return {
      present: true,
      methods: Object.fromEntries(methods.map((method) => [method, typeof value[method] === 'function'])),
    };
  };
  return {
    fs: shape(ctx.get('fs'), ['resolve', 'processPath', 'contains', 'stat', 'readText', 'writeText']),
    sessions: shape(ctx.get('sessions'), ['get', 'list']),
    sessionQuery: shape(ctx.get('sessionQuery'), ['readSession']),
    webServer: shape(ctx.get('webServer'), ['register']),
    sandbox: shape(ctx.get('sandbox'), ['policy']),
    sandboxPolicy: shape(ctx.get('sandboxPolicy'), ['resolve', 'overrideOf']),
  };
}

/**
 * Parse one page path into the session id and path a read or write needs.
 *
 * The address is the Session address the official preview opened this tab with:
 * `dsh-resource://file/session/<sessionId>/<path>`, where the path may be
 * workspace-relative or absolute and `:` stays literal (a Windows drive letter
 * reads `D:`). The `absolute/<path>` scope carries no authority and is refused;
 * authority always comes from a live Session.
 * @param address - the tab's `dsh-resource://file/...` address.
 * @returns `{ sessionId, path }`, or `undefined` when the address is not a
 * session-scoped file address.
 */
export function parseSessionFileAddress(address) {
  const PREFIX = 'dsh-resource://file/';
  if (typeof address !== 'string' || !address.startsWith(PREFIX)) return undefined;
  const segments = address.slice(PREFIX.length).split('/');
  if (segments[0] !== 'session') return undefined;
  const sessionId = decodeURIComponent(segments[1] ?? '');
  if (sessionId === '') return undefined;
  const path = segments
    .slice(2)
    .map((segment) => decodeURIComponent(segment))
    .join('/');
  if (path === '') return undefined;
  return { sessionId, path };
}

/**
 * The Session a file address belongs to.
 *
 * Several shapes are tried on purpose. The session lookup belongs to other
 * packages, and a plugin that only knows one spelling of it fails with
 * `unknown-session` for a reason that has nothing to do with this plugin — which
 * is exactly the kind of failure that costs a restart to discover.
 *
 * The Session object itself is worth keeping, not just its cwd: the sandbox
 * policy service resolves a per-call policy from the Session, and a file write
 * that does not carry that policy is refused by the sandboxed filesystem backend.
 * @param ctx - host plugin context.
 * @param sessionId - the authorizing Session's id.
 * @returns the Session, or `undefined` when no shape yields one.
 */
function sessionOf(ctx, sessionId) {
  const candidates = [];
  const sessions = ctx.get('sessions');
  if (sessions !== undefined && sessions !== null) {
    try {
      candidates.push(sessions.get?.(sessionId));
    } catch {
      /* shape mismatch; the next candidate may still work */
    }
    try {
      candidates.push(sessions.list?.getSnapshot?.()?.byId?.[sessionId]);
    } catch {
      /* same */
    }
    try {
      candidates.push(sessions.byId?.[sessionId]);
    } catch {
      /* same */
    }
  }
  for (const record of candidates) {
    if (record !== undefined && record !== null) {
      const cwd = record?.header?.cwd ?? record?.cwd ?? record?.session?.cwd;
      if (typeof cwd === 'string' && cwd !== '') return record;
    }
  }
  return undefined;
}

/**
 * The workspace root a session reads and writes inside.
 * @param ctx - host plugin context.
 * @param sessionId - the authorizing Session's id.
 * @returns the absolute root, or `undefined` when no shape yields one.
 */
async function workspaceRootOf(ctx, sessionId) {
  const record = sessionOf(ctx, sessionId);
  const live = record?.header?.cwd ?? record?.cwd ?? record?.session?.cwd;
  if (typeof live === 'string' && live !== '') return live;
  try {
    const record = await ctx.get('sessionQuery')?.readSession?.(sessionId);
    const cwd = record?.session?.cwd ?? record?.header?.cwd ?? record?.cwd;
    if (typeof cwd === 'string' && cwd !== '') return cwd;
  } catch {
    /* fall through to the unknown-session answer */
  }
  return undefined;
}

/**
 * The sandbox policy one write must carry.
 *
 * The deployment may mount `dsh-fs-sandbox` instead of the plain local backend,
 * and that backend fences **writes and edits only**: reads pass through, a write
 * checks the per-call policy and throws `FS_SANDBOX_DENIED` when the mode is
 * `read-only` or the target sits outside the policy's writable roots. Omitting the
 * argument does not mean "unrestricted" — it means "resolve the *deployment*
 * default", which is the wrong boundary for a session-scoped file.
 *
 * The official tool layer resolves `{ session }` on every mutation, so the
 * session's own mode and immutable cwd travel with the call. This does the same,
 * and degrades to the deployment fallback when the service is absent.
 * @param ctx - host plugin context.
 * @param session - the Session authorizing the write, when known.
 * @returns the per-call policy, or `undefined` to let the backend decide.
 */
function sandboxPolicyFor(ctx, session) {
  const service = ctx.get('sandboxPolicy');
  if (service === undefined || service === null || typeof service.resolve !== 'function') return undefined;
  try {
    return session === undefined ? service.resolve() : service.resolve({ session });
  } catch (error) {
    diagnose(`sandbox policy unresolved: ${String(error?.message ?? error)}`);
    return undefined;
  }
}

/**
 * Whether a workspace path is absolute in this backend's execution world.
 *
 * Windows drive paths (`D:/…`), UNC paths and POSIX paths all count. Used only to
 * decide whether a file can still be resolved when no workspace root is known.
 * @param path - the address's path.
 * @returns true when resolution does not need a working directory.
 */
function isAbsolutePath(path) {
  return path.startsWith('/') === true || /^[A-Za-z]:[\\/]/.test(path) === true || path.startsWith('\\\\') === true;
}

/**
 * Describe a resolved sandbox policy for a denial message.
 *
 * The shape belongs to `@deepseek-ai/dsh-sandbox`; this reads it defensively so a
 * denial can say *which* mode refused the write instead of just "denied".
 * @param policy - the policy handed to the write, when one was resolved.
 * @returns a short label for the mode and boundary.
 */
function describePolicy(policy) {
  if (policy === undefined || policy === null) return 'deployment-default';
  const mode = typeof policy.mode === 'string' ? policy.mode : 'unknown';
  const root = policy.workspaceRoot ?? policy.root ?? policy.cwd;
  return typeof root === 'string' && root !== '' ? `${mode} @ ${root}` : mode;
}

/**
 * Map a filesystem failure onto this channel's vocabulary.
 * @param error - the rejected value from `ctx.fs`.
 * @returns the failure code.
 */
function codeOf(error) {
  const code = error?.code ?? error?.name;
  switch (code) {
    case 'FS_NOT_FOUND':
      return CODES.notFound;
    case 'FS_NOT_REGULAR_FILE':
    case 'FS_NOT_DIRECTORY':
      return CODES.notRegularFile;
    case 'FS_NOT_TEXT':
      return CODES.notText;
    case 'FS_TOO_LARGE':
      return CODES.tooLarge;
    case 'FS_PERMISSION_DENIED':
      return CODES.forbidden;
    case 'FS_SANDBOX_DENIED':
      return CODES.sandboxDenied;
    case 'FS_STALE_VERSION':
      return 'conflict';
    default:
      return CODES.unavailable;
  }
}

/**
 * Whether the file on disk starts with a byte-order mark.
 *
 * The text API reads through a decoder that drops the mark, so a file carrying one
 * is indistinguishable from one without by text alone — and the first save would
 * quietly rewrite it without the mark. The bytes answer instead: three of them are
 * enough, and `readByteRange` reads only those.
 * @param fs - the filesystem service.
 * @param target - the resolved target.
 * @param raw - the text as the text API returned it.
 * @param signal - the caller's abort signal.
 * @returns true when the stored file begins with EF BB BF.
 */
async function detectBom(fs, target, raw, signal) {
  if (raw.startsWith(BOM)) return true;
  if (typeof fs.readByteRange !== 'function') return false;
  try {
    const head = await fs.readByteRange(target, { offset: 0, length: 3 }, signal);
    return head.length === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
  } catch {
    // An unreadable head is not worth failing an open over; the text is already here.
    return false;
  }
}

/**
 * Split storage text into what the editor edits and how to put it back.
 *
 * The editor works on LF text without a byte-order mark; both are restored on
 * save, so a CRLF file is not rewritten wholesale the first time it is touched.
 * @param raw - the file's text as the text API returned it.
 * @param bom - whether the stored file carries a byte-order mark.
 * @returns the editable text plus its restored encoding details.
 */
function toEditable(raw, bom) {
  const body = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const eol = body.includes('\r\n') ? 'crlf' : 'lf';
  return { text: body.replace(/\r\n/g, '\n'), eol, bom: bom === true };
}

/**
 * Rebuild storage text from what the editor produced.
 * @param text - LF text without a byte-order mark.
 * @param eol - `'crlf'` to restore Windows line endings.
 * @param bom - whether the file carries a byte-order mark.
 * @returns the exact string to write.
 */
function toStorage(text, eol, bom) {
  const body = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  return bom === true ? `${BOM}${body}` : body;
}

/**
 * Resolve one address into a target, and decide whether this plugin may write it.
 *
 * Every entry point below goes through this: the client sends an address, never a
 * path it chose, so the Session in the address is the whole authority. Reading
 * follows the same rule the shipped preview follows — a Session may read what its
 * filesystem backend allows, including paths outside the workspace — but writing
 * is fenced to the workspace, so a file outside it opens read-only instead of
 * failing to open at all.
 * @param ctx - host plugin context.
 * @param address - the tab's file address.
 * @returns `{ ok: true, target, absolutePath, writable }` or `{ ok: false, ... }`.
 */
async function resolveTarget(ctx, address) {
  const fs = ctx.get('fs');
  if (fs === undefined) return { ok: false, code: CODES.unavailable, message: 'no filesystem service' };
  const parsed = parseSessionFileAddress(address);
  if (parsed === undefined) return { ok: false, code: CODES.unsupportedAddress };
  const session = sessionOf(ctx, parsed.sessionId);
  const root = await workspaceRootOf(ctx, parsed.sessionId);
  if (root === undefined) {
    // Without a root, containment cannot be proven — but an absolute path is
    // still resolvable, and the session in the address is what authorizes the
    // read. Such a file opens read-only rather than failing to open at all.
    if (isAbsolutePath(parsed.path) !== true) {
      return { ok: false, code: CODES.unknownSession, message: 'no workspace root for a relative path' };
    }
    let absoluteTarget;
    try {
      absoluteTarget = await fs.resolve(parsed.path);
    } catch (error) {
      return { ok: false, code: codeOf(error), message: String(error?.message ?? error) };
    }
    return {
      ok: true,
      target: absoluteTarget,
      absolutePath: fs.processPath(absoluteTarget),
      path: parsed.path,
      writable: false,
      root: undefined,
      session,
    };
  }
  let target;
  let rootTarget;
  try {
    target = await fs.resolve(parsed.path, { cwd: root });
    rootTarget = await fs.resolve(root);
  } catch (error) {
    return { ok: false, code: codeOf(error), message: String(error?.message ?? error) };
  }
  const absolutePath = fs.processPath(target);
  const writable = fs.contains(rootTarget, target) === true;
  return { ok: true, target, absolutePath, path: parsed.path, writable, root, session };
}

/**
 * Read one file for the editor.
 * @param ctx - host plugin context.
 * @param payload - `{ address }`.
 * @param signal - the caller's abort signal.
 * @returns the editable text, its freshness token, and its encoding details.
 */
async function openFile(ctx, payload, signal) {
  const resolved = await resolveTarget(ctx, payload?.address);
  if (resolved.ok !== true) return resolved;
  const fs = ctx.get('fs');
  const info = await fs.stat(resolved.target, signal);
  if (info === undefined) return { ok: false, code: CODES.notFound, absolutePath: resolved.absolutePath };
  if (info.type !== 'file') {
    return { ok: false, code: CODES.notRegularFile, absolutePath: resolved.absolutePath, type: info.type };
  }
  if (typeof info.size === 'number' && info.size > MAX_BYTES) {
    return {
      ok: false,
      code: CODES.tooLarge,
      absolutePath: resolved.absolutePath,
      size: info.size,
      limit: MAX_BYTES,
    };
  }
  let raw;
  try {
    raw = await fs.readText(resolved.target, signal);
  } catch (error) {
    diagnose(`open failed: ${codeOf(error)} ${String(error?.message ?? error)}`);
    return {
      ok: false,
      code: codeOf(error),
      absolutePath: resolved.absolutePath,
      message: String(error?.message ?? error),
    };
  }
  const editable = toEditable(raw, await detectBom(fs, resolved.target, raw, signal));
  // A read-only sandbox mode refuses every write, whatever the workspace says. Saying
  // so at open time beats letting the user type and then fail on save.
  const policy = sandboxPolicyFor(ctx, resolved.session);
  const mode = typeof policy?.mode === 'string' ? policy.mode : undefined;
  const allowsWrite =
    mode === undefined
      ? true
      : mode === 'danger-full-access' || (mode === 'workspace-write' && resolved.writable === true);
  return {
    ok: true,
    absolutePath: resolved.absolutePath,
    path: resolved.path,
    version: info.version,
    bytes: info.size ?? Buffer.byteLength(raw, 'utf8'),
    writable: resolved.writable === true,
    sandbox: { mode, allowsWrite },
    ...editable,
  };
}

/**
 * Write the editor's buffer back.
 * @param ctx - host plugin context.
 * @param payload - `{ address, content, baseVersion, eol, bom }`.
 * @param signal - the caller's abort signal.
 * @returns the new freshness token, or a `conflict` carrying the current bytes.
 */
async function saveFile(ctx, payload, signal) {
  const resolved = await resolveTarget(ctx, payload?.address);
  if (resolved.ok !== true) return resolved;
  // Reading outside the workspace is allowed; writing is not.
  if (resolved.writable !== true) {
    return { ok: false, code: CODES.outsideWorkspace, absolutePath: resolved.absolutePath, root: resolved.root };
  }
  const content = payload?.content;
  if (typeof content !== 'string') {
    return { ok: false, code: CODES.badRequest, message: 'content must be a string' };
  }
  const fs = ctx.get('fs');
  const storage = toStorage(content, payload?.eol, payload?.bom);
  const size = Buffer.byteLength(storage, 'utf8');
  if (size > MAX_BYTES) {
    return { ok: false, code: CODES.tooLarge, size, limit: MAX_BYTES, absolutePath: resolved.absolutePath };
  }
  // No `baseVersion` means the caller chose to overwrite whatever is on disk.
  const expected =
    typeof payload?.baseVersion === 'string' && payload.baseVersion !== ''
      ? { kind: 'replaceIfVersion', version: payload.baseVersion }
      : undefined;
  // The deployment may mount the sandboxed filesystem, which fences writes by a
  // per-call policy. Nothing may write without it: a missing policy is not
  // "unrestricted", it resolves the deployment default instead, which refuses a
  // session-scoped path under `read-only`/`workspace-write`.
  const sandboxPolicy = sandboxPolicyFor(ctx, resolved.session);
  try {
    const outcome = await fs.writeText(resolved.target, storage, expected, signal, sandboxPolicy);
    return {
      ok: true,
      absolutePath: resolved.absolutePath,
      version: outcome.version,
      operation: outcome.operation,
      bytes: size,
    };
  } catch (error) {
    const code = codeOf(error);
    if (code !== 'conflict') {
      // Without this line the only evidence is a UI that says "failed".
      diagnose(`save failed: ${code} (${String(error?.code ?? error?.name ?? 'no code')}) ${String(error?.message ?? error)}`);
      return {
        ok: false,
        code,
        absolutePath: resolved.absolutePath,
        message: String(error?.message ?? error),
        ...(code === CODES.sandboxDenied ? { sandboxMode: describePolicy(sandboxPolicy) } : {}),
      };
    }
    // Hand the caller the state it conflicted with, so the UI can offer
    // "overwrite" or "reload" without a second round trip.
    const fresh = await openFile(ctx, payload, signal);
    return {
      ok: false,
      code: 'conflict',
      absolutePath: resolved.absolutePath,
      current:
        fresh.ok === true
          ? { text: fresh.text, version: fresh.version, eol: fresh.eol, bom: fresh.bom }
          : undefined,
    };
  }
}

/**
 * Per-address FIFO queue for the two routes that touch the same bytes.
 *
 * Switching one tab from the rich text view to the code view unmounts one body and
 * mounts the other. The unmounting body's last write is still in flight while the
 * new body asks for the file, and the two requests arrive on separate browser
 * connections: nothing in HTTP orders them. This is the only place that can, and it
 * is available here precisely because both views are one plugin with one host half.
 *
 * Runs are keyed by the address, so unrelated files never wait on each other.
 * @param key - the address whose operations must not overlap.
 * @param run - the operation.
 * @returns the operation's result.
 */
function serialisedByAddress(key, run) {
  const previous = serialisedByAddress.queues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const guarded = next.catch(() => {});
  serialisedByAddress.queues.set(key, guarded);
  void guarded.then(() => {
    if (serialisedByAddress.queues.get(key) === guarded) serialisedByAddress.queues.delete(key);
  });
  return next;
}

/** In-flight keys; module state because the queue must outlive one request. */
serialisedByAddress.queues = new Map();

/**
 * Host plugin body: mount the HTTP endpoints for this plugin's lifetime.
 *
 * `connection.fetch.register` is the extension point that works from a plugin in
 * this build, and it is the only one. The obvious alternative,
 * `connection.rpc.handle(channel, handler)`, is unusable here: it ends in
 * `owner.webServer.register(route)` where `owner` is the *service's own* context
 * — whose inject list is `['credentials']`, not `['webServer']` — so it throws
 * `cannot get property "webServer" without inject`. Cordis drops that child fiber
 * silently, the plugin still reads as active, and every request answers 405 from
 * the SPA fallback. That failure mode cost one debugging round; `diagnose()`
 * below exists so it can never do so again.
 *
 * Routes live under `/api`, whose prefix route already applies the Host/Origin
 * fence and the signed browser cookie, so a same-origin fetch from the page is
 * authenticated exactly like the rest of the UI — no route of ours is reachable
 * without admission.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  diagnose(`apply: connection=${ctx.get('connection') !== undefined} fs=${ctx.get('fs') !== undefined}`);

  /** One operation per route; each handler takes the decoded body and the signal. */
  const endpoints = {
    ping: async () => ({ ok: true, plugin: name, version: VERSION, pid: process.pid }),
    probe: async () => ({ ok: true, services: probeServices(ctx) }),
    open: (payload, signal) =>
      serialisedByAddress(typeof payload?.address === 'string' ? payload.address : '', () =>
        openFile(ctx, payload, signal),
      ),
    save: (payload, signal) =>
      serialisedByAddress(typeof payload?.address === 'string' ? payload.address : '', () =>
        saveFile(ctx, payload, signal),
      ),
    report: async (payload) => {
      const report = { receivedAt: new Date().toISOString(), payload: payload ?? null };
      try {
        writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
      } catch (error) {
        return { ok: false, code: 'report-write-failed', message: String(error) };
      }
      return { ok: true, path: REPORT_PATH };
    },
    /**
     * A breadcrumb from the browser half, appended to the host log.
     *
     * The browser console is not reachable from outside the app, so a mount failure in
     * the editor would otherwise be invisible: this route is how the client half says
     * "this threw", and the log on disk is where it can be read afterwards.
     */
    diag: async (payload) => {
      const text = payload === undefined ? '(empty)' : JSON.stringify(payload);
      appendFileSync(DIAG_PATH, `${new Date().toISOString()} client: ${text}\n`, 'utf8');
      return { ok: true };
    },
  };

  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection;
    if (connection?.fetch?.register === undefined) {
      diagnose('apply: Connection has no fetch.register; endpoints stay unregistered');
      return;
    }
    for (const [endpoint, handler] of Object.entries(endpoints)) {
      const path = `${ROUTE_PREFIX}/${endpoint}`;
      try {
        ctx.effect(
          () =>
            connection.fetch.register({
              path,
              methods: ['POST'],
              requestBody: 'buffered',
              fetch: async (request) => {
                let payload;
                try {
                  payload = await request.json();
                } catch {
                  payload = undefined;
                }
                try {
                  return Response.json(await handler(payload, request.signal));
                } catch (error) {
                  diagnose(`${endpoint} threw: ${error?.stack ?? error}`);
                  return Response.json({
                    ok: false,
                    code: 'unavailable',
                    message: String(error?.message ?? error),
                  });
                }
              },
            }),
          `dsh-sidebar-milkdown: ${path}`,
        );
        diagnose(`route ${path} registered`);
      } catch (error) {
        diagnose(`route ${path} registration failed: ${error?.stack ?? error}`);
      }
    }
    // The deployment's own fallback policy, recorded once at load: if a save is ever
    // refused, this says which mode and boundary the sandbox would use without a
    // session — the first thing worth knowing when a write is denied.
    const fallback = sandboxPolicyFor(ctx, undefined);
    diagnose(`sandbox: ${describePolicy(fallback)}`);
  });
}



