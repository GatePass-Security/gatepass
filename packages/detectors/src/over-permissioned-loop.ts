import type { Detector, DetectorFinding, ScanContext, ScanFile } from "@gatepass/engine";
import type { Surface } from "@gatepass/findings";

/**
 * Research-tier detector: over-permissioned autonomous loop.
 *
 * The shape, stated independently of any one codebase: an agent drives a model and invokes
 * tools inside an iteration construct that has no *effective* bound, so a single request can
 * expand into unlimited privileged actions.
 *
 * Two judgements carry the whole detector, and both are about meaning rather than syntax:
 *
 *  1. What counts as iteration. `while (true)`, `while True:`, `for (;;)`, a Go bare `for {}`,
 *     a `for` with an empty condition, and a boolean flag loop are all the same construct. So
 *     is a queue worker that re-enqueues its own follow-up job — iteration with no loop keyword
 *     at all, where the "loop body" is the handler and the "back edge" is the enqueue call.
 *
 *  2. What counts as a bound. A bound is effective only if something *outside the model's
 *     control* can stop the loop. A step counter is a bound — unless it is reset from tool or
 *     model output, in which case the model can extend its own budget forever and the counter
 *     is decoration. A wall-clock deadline, a cost/token ceiling, and a human approval gate are
 *     bounds. `break`/`return` are NOT bounds on their own: `if step.Done { return }` hands the
 *     stopping decision to the very model whose runaway behaviour is the risk. Refusing to
 *     count a bare `break` is the single most important rule here.
 */

type Lang = "js" | "py" | "go" | "php" | "rust";

interface LoopSite {
  /** 0-indexed line of the loop header. */
  index: number;
  header: string;
  body: string;
  kind: string;
}

function langOf(relPath: string): Lang | null {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(relPath)) return "js";
  if (/\.py$/i.test(relPath)) return "py";
  if (/\.go$/i.test(relPath)) return "go";
  if (/\.php$/i.test(relPath)) return "php";
  if (/\.rs$/i.test(relPath)) return "rust";
  return null;
}

/**
 * String delimiters, per language. Rust is the exception that forces this to be a table rather
 * than a constant: `'` there opens a lifetime (`&'static str`) or a char literal, never a string.
 * Treating it as a quote makes every brace after the first lifetime annotation unbalanced, so a
 * function body is read as running to the end of the file — which is worse than not reading Rust
 * at all, because the wrong body then gets a verdict.
 */
const QUOTES: Record<Lang, string> = {
  js: "\"'`",
  py: "\"'",
  go: "\"'`",
  php: "\"'`",
  rust: '"',
};

/**
 * Blank out comments, preserving offsets and line structure. A comment that says
 * "bounded by a deadline" must never be mistaken for a deadline, and a commented-out
 * `while (true)` must never be mistaken for a loop.
 */
function blankComments(src: string, lang: Lang): string {
  const out = src.split("");
  let i = 0;
  let str: string | null = null;
  // PHP accepts both `//` and `#`; Python only `#`; everything else only `//`.
  const lineComments = lang === "py" ? ["#"] : lang === "php" ? ["//", "#"] : ["//"];
  const quotes = QUOTES[lang];
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (str) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (quotes.includes(c)) {
      str = c;
      i++;
      continue;
    }
    if (lineComments.some((lc) => src.startsWith(lc, i))) {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (lang !== "py" && c === "/" && next === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      out[i] = " ";
      if (i + 1 < src.length) out[i + 1] = " ";
      i += 2;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Index of the `}` matching the `{` at `open`. String-aware; comments are already blanked. */
function matchBrace(src: string, open: number, lang: Lang = "js"): number {
  let depth = 0;
  let str: string | null = null;
  const quotes = QUOTES[lang];
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (quotes.includes(c)) str = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length;
}

/** Split a call's argument list (excluding the outer parens) at top-level commas. */
function splitArgs(src: string, openParen: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let str: string | null = null;
  let start = openParen + 1;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i]!;
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        args.push(src.slice(start, i));
        return { args, end: i };
      }
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return { args, end: src.length };
}

/** 0-based line index of a character offset. */
function lineIndexOf(content: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < Math.min(offset, content.length); i++) if (content[i] === "\n") line++;
  return line;
}

/** Body of an indentation-delimited Python suite starting after `headerIdx`. */
function pythonSuite(lines: string[], headerIdx: number): string {
  const header = lines[headerIdx] ?? "";
  const base = header.length - header.trimStart().length;
  const out: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    if (line.length - line.trimStart().length <= base) break;
    out.push(line);
  }
  return out.join("\n");
}

/* ── 1. Iteration constructs ─────────────────────────────────────────────────────────── */

const JS_LOOPS: { re: RegExp; kind: string }[] = [
  { re: /\bwhile\s*\(\s*(?:true|1)\s*\)/i, kind: "while (true)" },
  { re: /\bfor\s*\(\s*;\s*;\s*[^)]*\)/, kind: "for (;;)" },
  // `for (let i = 0; ; i++)` — an init/post clause but no exit condition.
  { re: /\bfor\s*\([^;()]*;\s*;/, kind: "for with no condition" },
  { re: /\bdo\s*\{/, kind: "do/while" },
];
const PY_LOOPS: { re: RegExp; kind: string }[] = [{ re: /\bwhile\s+(?:True|1)\s*:/, kind: "while True:" }];
const GO_LOOPS: { re: RegExp; kind: string }[] = [
  { re: /\bfor\s*\{/, kind: "for {}" },
  { re: /\bfor\s+true\s*\{/, kind: "for true {}" },
  // `for step := 0; ; step++ {` — a Go for with an empty condition clause.
  { re: /\bfor\s+[^;{}\n]*;\s*;[^{}\n]*\{/, kind: "for with no condition" },
];
const RUST_LOOPS: { re: RegExp; kind: string }[] = [
  { re: /\bloop\s*\{/, kind: "loop {}" },
  { re: /\bwhile\s+true\s*\{/, kind: "while true {}" },
];

/**
 * A loop whose only exit condition is a boolean flag (`while (!done)`, `while not finished:`)
 * is unbounded in the same way a `while (true)` is, provided the flag is set from model or
 * tool output inside the body. A flag set from a counter or a clock is a different thing and
 * is picked up by the bound analysis below.
 */
const FLAG_LOOP_JS = /\bwhile\s*\(\s*(!?\s*[A-Za-z_$][\w$.]*)\s*\)/;
const FLAG_LOOP_PY = /\bwhile\s+(not\s+)?([A-Za-z_][\w.]*)\s*:/;
/** Rust drops the parentheses. `while let Some(x) = …` is not a flag loop and does not match. */
const FLAG_LOOP_RUST = /\bwhile\s+(!?\s*[A-Za-z_][\w.]*)\s*\{/;

function loopTable(lang: Lang): { re: RegExp; kind: string }[] {
  // PHP spells its loops the C way, so it shares the JS table.
  if (lang === "js" || lang === "php") return JS_LOOPS;
  if (lang === "py") return PY_LOOPS;
  if (lang === "rust") return RUST_LOOPS;
  return GO_LOOPS;
}

function findLoops(content: string, lang: Lang): LoopSite[] {
  const lines = content.split(/\r?\n/);
  const sites: LoopSite[] = [];
  const table = loopTable(lang);

  lines.forEach((line, i) => {
    let kind: string | null = null;
    for (const entry of table) {
      if (entry.re.test(line)) {
        kind = entry.kind;
        break;
      }
    }
    if (!kind && lang !== "go") {
      // Boolean-flag loop: no comparison operators and no numeric literal in the condition.
      const flag = lang === "py" ? FLAG_LOOP_PY : lang === "rust" ? FLAG_LOOP_RUST : FLAG_LOOP_JS;
      const m = flag.exec(line);
      if (m && !/[<>=!]=|[<>]|\d/.test(m[0].replace(/^while/, ""))) kind = "flag-controlled loop";
    }
    if (!kind) return;

    let body: string;
    if (lang === "py") {
      body = pythonSuite(lines, i);
    } else {
      const offset = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
      const open = content.indexOf("{", offset);
      body = open >= 0 ? content.slice(open, matchBrace(content, open, lang) + 1) : lines.slice(i, i + 30).join("\n");
    }
    sites.push({ index: i, header: line, body, kind });
  });
  return sites;
}

/* ── 2. Does the loop actually drive an agent? ───────────────────────────────────────── */

const MODEL_CALL =
  /(\b(llm|model|agent|assistant|planner|brain|client|anthropic|openai|bedrock|gemini|ollama|chain)\b\s*\.\s*\w*(run|call|complete|completion|chat|invoke|next|create|generate|send|step|respond|predict|stream|act)\w*\s*\()|(\b(call|invoke|run|query|ask)_?(model|llm|agent|assistant|completion)\w*\s*\()|(messages\s*\.\s*create\s*\()|(chat\s*\.\s*completions\s*\.\s*create)|(generate(Text|Content|Object)\s*\()|(\.\s*Next\s*\(\s*ctx)|(\.\s*Next\s*\(\s*\w*[Cc]tx)/i;

const TOOL_CALL =
  /((run|call|execute|invoke|dispatch|perform|apply|handle)_?tools?\b)|(\btools?\s*\[)|(\btools?\s*\.\s*\w+\s*\()|(\btool\s*\(\s*\w)|(tool_?(calls?|use|uses|name|args|input|result|invocations?)\b)|(function_?calls?\b)|(ToolName|ToolArgs|ToolFunc|ToolCall)|(\.\s*(useTool|toolUse)\b)/i;

function drivesAgent(body: string): boolean {
  return MODEL_CALL.test(body) || TOOL_CALL.test(body);
}

/* ── 3. Is there an EFFECTIVE bound? ─────────────────────────────────────────────────── */

const CAP_WORD = /(max|min|limit|cap|budget|quota|ceiling|threshold|allowance)/i;
const EXIT = /\b(return|break|throw|raise|panic|exit|sys\.exit|os\.Exit|abort|reject)\b/i;

/**
 * `x >= MAX`, `MAX <= x`, `x > 25` — returns the counter-side identifier when it is a cap test.
 *
 * Equality is in the operator set for one reason: a budget that counts DOWN is exhausted by
 * `if (steps_left == 0) return`, which is the same bound as `if (steps >= MAX) return` written
 * from the other end. Admitting `==` costs nothing in precision because a comparison only
 * becomes a candidate bound if the value is also advanced every iteration — `if (name == "x")`
 * and `if (results.length === 0)` compare things nothing counts, and are dropped below.
 */
function capComparisons(body: string): string[] {
  const found: string[] = [];
  const re = /([A-Za-z_$][\w$.]*)\s*(>=|<=|===|!==|==|!=|>|<)\s*([A-Za-z_$][\w$.]*|\d[\d_.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const left = m[1]!;
    const right = m[3]!;
    const leftIsCap = CAP_WORD.test(left);
    const rightIsCap = CAP_WORD.test(right) || /^\d/.test(right);
    // The comparison must lead to an exit, otherwise it is a branch, not a bound.
    const after = body.slice(m.index, m.index + 220);
    if (!EXIT.test(after)) continue;
    if (rightIsCap && !leftIsCap) found.push(left);
    else if (leftIsCap && !rightIsCap) found.push(right);
    else if (leftIsCap && rightIsCap) found.push(left);
  }
  return found;
}

/**
 * The counter moves every iteration — in either direction. `steps++` and
 * `steps_left = steps_left.saturating_sub(1)` are the same mechanism: a budget that counts up
 * to a ceiling and one that counts down to zero. The general form is an assignment whose
 * right-hand side READS the counter, which covers `x = x + 1`, `x = x - 1`,
 * `x = x.saturating_sub(1)` and `x = max(x - 1, 0)` without a list of arithmetic spellings —
 * and is precisely the complement of `isReset`, where the right-hand side does not.
 */
function isAdvanced(name: string, text: string): boolean {
  const id = name.replace(/[.$]/g, "\\$&");
  if (new RegExp(`([+-]{2}\\s*${id}\\b)|(\\b${id}\\s*[+-]{2})|(\\b${id}\\s*[-+]=)`).test(text)) return true;
  const assign = new RegExp(`\\b${id}\\s*=\\s*(?!=)([^;\\n]*)`, "g");
  const reads = new RegExp(`\\b${id}\\b`);
  let m: RegExpExecArray | null;
  while ((m = assign.exec(text))) if (reads.test(m[1] ?? "")) return true;
  return false;
}

/**
 * The counter is reset to a constant somewhere in the loop body. A budget the loop can hand
 * back to itself is not a budget — this is what makes `steps = 0` on a tool result a finding
 * rather than a clean bounded loop.
 */
function isReset(name: string, body: string): { reset: boolean; line: string } {
  const id = name.replace(/[.$]/g, "\\$&");
  const re = new RegExp(`^[^\\n]*?\\b${id}\\s*=\\s*(?!=)([^=\\n]*)$`, "m");
  for (const raw of body.split(/\r?\n/)) {
    const m = re.exec(raw);
    if (!m) continue;
    const rhs = (m[1] ?? "").trim().replace(/[;,]+$/, "");
    // `x = x + 1` is an increment, not a reset. A bare literal or a re-init is a reset.
    if (new RegExp(`\\b${id}\\b`).test(rhs)) continue;
    if (/^\d[\d_.]*$/.test(rhs) || /^(0|None|nil|null)$/i.test(rhs)) return { reset: true, line: raw.trim() };
  }
  return { reset: false, line: "" };
}

const DEADLINE_CHECK =
  /(<-\s*\w*[Cc]tx\.Done\s*\(\))|(\w*[Cc]tx\.(Done|Err)\s*\(\))|(time\.(Since|After|Now)\s*\()|(time\.(monotonic|time|perf_counter)\s*\(\))|(Date\.now\s*\(\))|(performance\.now\s*\(\))|(datetime\.(now|utcnow)\s*\()|(\bdeadline\b)|(\belapsed\b)|(signal\s*\.\s*aborted)|(\btimed?_?out\b)/i;
const DEADLINE_SOURCE =
  /(context\.With(Timeout|Deadline))|(AbortSignal\.timeout)|(setTimeout\s*\()|(\w*(TIMEOUT|DEADLINE|MAX_SECONDS|MAX_DURATION|BUDGET|_MS|_SECONDS)\w*)|(time\.(After|NewTimer|NewTicker)\s*\()|(\bstart(ed|Time|_time)?\b\s*=)|(\bdeadline\b\s*=)/i;

const COST_WORD = /(spent|spend|cost|usd|dollars?|tokens?_?used|token_?count|credits?|charges?|price)/i;

/**
 * A person standing in the loop is a bound, and the two ways that is written both have to be
 * recognised from inside the loop body:
 *
 *   - the loop blocks on an interactive read. The canonical spelling is a call on a prompt
 *     object — `rl.question(...)`, `prompt(...)`, `input(...)`. The *construction* of that
 *     object (`createInterface`, `import readline`) sits above the loop, so matching only the
 *     construction never fires; the blocking call is what has to be matched.
 *   - the loop blocks on an approval service. `approvals.request(...)`, `gate.await(...)`,
 *     `confirmations.acquire(...)` — the approval noun is on the *receiver*, not the method, so
 *     a `word(` pattern misses all of them. Matching the stem anywhere in a call's receiver is
 *     what generalises across the naming.
 */
const HUMAN_GATE =
  /((confirm|approve|approval|authorize|consent)\w*\s*\()|(\b\w*(?:approval|approve|confirm|authoriz|consent)\w*\s*\.\s*\w+\s*\()|(\b(await|wait)_?for_?(human|user|approval|confirmation))|(ask_?(user|human)\w*\s*\()|(require_?(human|approval|confirmation))|(human_?in_?the_?loop)|(\binput\s*\(\s*['"])|(readline|readLine|createInterface|prompts?\s*\()|(\.\s*question\s*\()|(bufio\.NewScanner\s*\(\s*os\.Stdin)|(fmt\.Scan\w*\s*\()|(sys\.stdin)|(\bprompt_?toolkit\b)/i;

interface BoundVerdict {
  bounded: boolean;
  /** Set when a counter bound exists but is neutralised by a reset inside the loop. */
  defeated?: { counter: string; line: string };
}

function analyseBound(loop: LoopSite, scopeBefore: string): BoundVerdict {
  const searchable = loop.header + "\n" + loop.body;

  // (a) Wall-clock deadline. A `ctx.Done()` check only bounds anything if a timeout was
  //     actually installed — on a plain context.Background() it can never fire.
  if (DEADLINE_CHECK.test(loop.body)) {
    const selfContained =
      /(time\.(Since|monotonic|time|perf_counter)\s*\(|Date\.now\s*\(\)|performance\.now\s*\(\)|datetime\.(now|utcnow)\s*\()[^\n]*[-][^\n]*/.test(
        loop.body,
      ) && /[<>]=?/.test(loop.body);
    if (selfContained) return { bounded: true };
    if (DEADLINE_SOURCE.test(scopeBefore) || DEADLINE_SOURCE.test(loop.body)) return { bounded: true };
  }

  // (b) Human approval gate inside the loop — a loop that cannot advance without a person
  //     is not autonomous, and so cannot run away.
  if (HUMAN_GATE.test(loop.body)) return { bounded: true };

  // (c) Counter / cost ceiling. Effective only if monotonically advanced and never reset.
  const counters = capComparisons(searchable);
  let sawLiveBound = false;
  let defeated: { counter: string; line: string } | undefined;
  for (const name of counters) {
    const advanced = isAdvanced(name, searchable) || COST_WORD.test(name);
    if (!advanced) continue;
    const reset = isReset(name, loop.body);
    if (reset.reset) {
      defeated = { counter: name, line: reset.line };
      continue;
    }
    sawLiveBound = true;
  }
  if (sawLiveBound) return { bounded: true };
  if (defeated) return { bounded: false, defeated };
  return { bounded: false };
}

/* ── 4. Iteration without a loop keyword: the self-re-enqueueing worker ──────────────── */

/**
 * A queue worker that ends a job by enqueueing another job of the name it is registered to handle
 * is iterating. The handler is the loop body and the enqueue is the back edge; there is no loop
 * keyword anywhere in the file, so §1 is blind to it.
 *
 * Three things have to line up, and each is spelled several ways in practice:
 *
 *   - the REGISTRATION. `new Worker(name, fn)` (BullMQ), `queue.process(name, fn)`, a Celery
 *     `@app.task` / `@shared_task` decorator (where the job's name is the *function's* name unless
 *     a `name=` overrides it), an SQS consumer (where the identity is the queue URL, not a name),
 *     and a Temporal workflow (where `continueAsNew` is the back edge outright).
 *   - the JOB IDENTITY. `new Worker(JOB, ...)` / `queue.add(JOB, ...)` never touches a string
 *     literal, so names are resolved through module constants — and two unresolvable identifiers
 *     still match each other, because the same constant naming both ends is the point.
 *   - the BOUND. A chain is bounded only if a depth/attempt/generation count rides along on the
 *     payload and something compares it against a cap. `max_retries=` on a Celery task is the
 *     same idea expressed by the framework.
 *
 * What stays out of reach from one file: a worker that enqueues a *differently named* job which
 * transitively schedules the first one back. That needs a queue-graph across files.
 */

/**
 * A TypeScript call may carry explicit type arguments between the callee and its parentheses —
 * `new Worker<StepJob>(...)`, `queue.add<Payload>(...)`. Every registration and enqueue pattern
 * here has to tolerate them, or the entire back-edge analysis goes blind on typed codebases,
 * which is most of them.
 */
const TYPE_ARGS = String.raw`(?:\s*<[^<>()\n]{0,160}(?:<[^<>()\n]{0,80}>)?[^<>()\n]{0,40}>)?`;

/** `queue.add(name, ...)`, `sqs.send(new SendMessageCommand({...}))` — identity in the arguments. */
const ENQUEUE_BY_ARG = new RegExp(
  String.raw`\.\s*(?:add|addBulk|enqueue|publish|dispatch|schedule|send|push|emit|sendMessage|SendMessage|Enqueue|createJob|perform_later|perform_async|send_task)${TYPE_ARGS}\s*\(`,
  "g",
);
/** `task.apply_async(...)`, `task.delay(...)`, `self.retry(...)` — the receiver *is* the job. */
const ENQUEUE_BY_RECEIVER = /\b([A-Za-z_$][\w$]*)\s*\.\s*(?:apply_async|delay|retry|apply)\s*\(/g;
/**
 * PHP/Laravel spells the back edge as a static call on the job class itself: `self::dispatch(...)`
 * from inside `handle()`, or `dispatch(new AgentStepJob(...))`. The receiver — `self`, `static`,
 * or the class name — is the job identity, exactly as the Celery task function is in Python.
 */
const ENQUEUE_BY_STATIC =
  /\b(self|static|[A-Za-z_]\w*)\s*::\s*(?:dispatch|dispatchSync|dispatchNow|dispatchIf|dispatchUnless|dispatchAfterResponse)\s*\(/g;
const ENQUEUE_BY_NEW = /\bdispatch\s*\(\s*new\s+\\?([A-Za-z_][\w\\]*)/g;
/** An SQS/SNS destination stands in for a job name. */
const QUEUE_URL_PROP = /\b(?:QueueUrl|queueUrl|queue_url|QueueURL|TopicArn|topicArn)\s*[:=]\s*([^,\n}]+)/g;
const WORKER_HANDLER = new RegExp(String.raw`(?:new\s+(?:\w+\.)?Worker${TYPE_ARGS}\s*\(|\bHandle(?:Func)?\s*\()`, "g");
/**
 * `queue.process(name, fn)` and its cousins. `on`/`handle`/`register` also spell an EventEmitter
 * subscription, and `emitter.on("tick", () => emitter.emit("tick"))` is not a job queue — so this
 * branch is gated on the file naming a queue at all.
 */
const GENERIC_HANDLER = new RegExp(
  String.raw`\b\w+\s*\.\s*(?:process|work|on|subscribe|consume|handle|register|task|worker)${TYPE_ARGS}\s*\(`,
  "g",
);
const QUEUE_EVIDENCE =
  /\b(queue|Queue|worker|Worker|job|Job|bull|bullmq|BullMQ|celery|Celery|sqs|SQS|kafka|Kafka|rabbit|amqp|pubsub|PubSub|temporal|Temporal|sidekiq|resque|task_queue|taskQueue)\b/;
const SQS_CONSUMER = /\b(?:Consumer\s*\.\s*create|new\s+(?:\w+\.)?Consumer)\s*\(/g;
const CONTINUE_AS_NEW = /\bcontinueAsNew\s*\(/g;
const TEMPORAL_EVIDENCE = /(@temporalio)|(proxyActivities)|(defineSignal)|(workflow\.)/;

/**
 * The chain is bounded only when something counts how far *along the chain* a job is and refuses
 * to go further — a depth/generation/hop carried on the payload and compared against a cap.
 *
 * This is why the comparison is required. A per-attempt ceiling is a different quantity that
 * reads like the same word: Laravel's `public $tries = 1` and `public $timeout = 120`, BullMQ's
 * `attempts: 3`, a Temporal activity's `startToCloseTimeout` all bound ONE attempt of ONE job.
 * A handler that succeeds and then enqueues its successor never retries anything, so a retry
 * ceiling of one and a two-minute per-attempt timeout leave the chain completely unbounded. Only
 * a value that survives across jobs and is tested can stop it.
 */
const ATTEMPT_GUARD =
  /\b(attempts?|attemptsMade|retries|retry_?count|depth|generation|hop|hops|iteration|round|pass_?count|fanout|recursion)\b[^\n]{0,40}(>=|>|<|<=)/i;
/** A framework-supplied retry ceiling is a real bound even without an explicit comparison. */
const RETRY_CAP = /\bmax_?retries\s*=\s*\d+/i;

interface Registration {
  /** 0-based line of the registration. */
  index: number;
  /** Normalised job identities: `s:<literal>` when resolvable, `i:<ident>` when not. */
  names: Set<string>;
  /** Bare identifiers that *are* this job — the Celery task function, and `self` when bound. */
  receivers: Set<string>;
  /** Character ranges that make up the handler: the registration call, plus any named handler. */
  ranges: [number, number][];
  kind: string;
}

/** A candidate back edge: one enqueue-shaped call, resolved to whatever names its destination. */
interface Edge {
  offset: number;
  identity: string | null;
  receiver: string | null;
}

/**
 * Cost ceilings. `buildScanContext` ingests `dist/`, and a minified bundle contains thousands of
 * `x.on(`-shaped fragments; without these the registration × file cross product is quadratic.
 */
const MAX_REGISTRATIONS = 200;
const MAX_EDGES = 500;
const ARG_WINDOW = 4000;

function windowedArgs(src: string, open: number): string[] {
  return splitArgs(src.slice(open, open + ARG_WINDOW), 0).args;
}

/** Minified build output: one enormous line, no recoverable handler structure. */
function looksGenerated(content: string): boolean {
  if (content.length < 50_000) return false;
  let newlines = 0;
  let lineStart = 0;
  let longest = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) !== 10) continue;
    newlines++;
    if (i - lineStart > longest) longest = i - lineStart;
    lineStart = i + 1;
  }
  if (content.length - lineStart > longest) longest = content.length - lineStart;
  // One 2000-character line is a bundle, not something a person typed.
  return longest > 2000 || content.length / (newlines + 1) > 300;
}

/** Module-level string constants, so `const JOB = "x"` makes `queue.add(JOB, …)` legible. */
function stringConstants(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:const|let|var)?\s*\b([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(["'`])([^"'`\n]*)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) if (!out.has(m[1]!)) out.set(m[1]!, m[3]!);
  return out;
}

function jobIdentity(raw: string, consts: Map<string, string>): string | null {
  const t = raw.trim().replace(/[;,]+$/, "");
  if (t === "") return null;
  const lit = /^(["'`])([^"'`]*)\1$/.exec(t);
  if (lit) return "s:" + lit[2]!;
  if (/^[A-Za-z_$][\w$.]*$/.test(t)) {
    const v = consts.get(t);
    return v === undefined ? "i:" + t : "s:" + v;
  }
  return null;
}

/** Strip the `s:`/`i:` tag for the explanation — the reader wants the job name, not the encoding. */
function displayJob(identity: string): string {
  return identity.slice(2);
}

/** A handler passed by reference — `new Worker("x", handleJob)` — still has to be read. */
function functionRange(name: string, content: string, lang: Lang): [number, number] | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  if (lang === "py") {
    const lines = content.split(/\r?\n/);
    const re = new RegExp(`^([ \\t]*)(?:async\\s+)?def\\s+${name}\\s*\\(`);
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (re.test(line)) {
        const suite = pythonSuite(lines, i);
        const start = acc + line.length + 1;
        return [start, start + suite.length];
      }
      acc += line.length + 1;
    }
    return null;
  }
  const re = new RegExp(
    `(?:function\\s*\\*?\\s*${name}\\s*\\()|(?:(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]+)?=)|(?:func\\s+${name}\\s*\\()`,
  );
  const m = re.exec(content);
  if (!m) return null;
  const open = content.indexOf("{", m.index);
  return open >= 0 && open - m.index < 300 ? [open, matchBrace(content, open) + 1] : null;
}

/**
 * A queued-job class: PHP's registration is the class declaration itself. Laravel dispatches by
 * class, so `class AgentStepJob implements ShouldQueue` both declares the handler (`handle()`)
 * and names the job — there is no separate `Worker("name", fn)` line to find.
 */
/** PSR-12 puts the brace on its own line, so the header may not end on the `class` line. */
const PHP_CLASS = /\bclass\s+(\w+)\b[^{;]{0,200}\{/g;
const PHP_QUEUED_MARKER = /\bShouldQueue\b|\bInteractsWithQueue\b|\bQueueable\b|\bDispatchable\b/;

function findPhpJobClasses(content: string): Registration[] {
  const out: Registration[] = [];
  PHP_CLASS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHP_CLASS.exec(content)) && out.length < MAX_REGISTRATIONS) {
    const open = content.indexOf("{", m.index);
    if (open < 0) continue;
    const close = matchBrace(content, open);
    const body = content.slice(open, close + 1);
    // Only a queued job iterates by dispatching; an Eloquent model that calls
    // `static::creating(...)` is not a back edge.
    if (!PHP_QUEUED_MARKER.test(m[0]) && !PHP_QUEUED_MARKER.test(body.slice(0, 600))) continue;
    const name = m[1]!;
    out.push({
      index: lineIndexOf(content, m.index),
      names: new Set(["s:" + name, "i:" + name]),
      receivers: new Set([name, "self", "static"]),
      ranges: [[open, close + 1]],
      kind: "queued job",
    });
  }
  return out;
}

function findRegistrations(content: string, lang: Lang, consts: Map<string, string>): Registration[] {
  const out: Registration[] = [];
  let m: RegExpExecArray | null;

  if (lang === "php") return findPhpJobClasses(content);

  if (lang !== "py") {
    const tables = [WORKER_HANDLER, ...(QUEUE_EVIDENCE.test(content) ? [GENERIC_HANDLER] : [])];
    for (const table of tables) {
      table.lastIndex = 0;
      while ((m = table.exec(content)) && out.length < MAX_REGISTRATIONS) {
        const open = m.index + m[0].length - 1;
        const { args, end } = splitArgs(content.slice(open, open + ARG_WINDOW), 0);
        const id = jobIdentity(args[0] ?? "", consts);
        if (id === null) continue;
        const ranges: [number, number][] = [[open, open + end + 1]];
        // Follow a handler passed by name, so its body is searched for the back edge too.
        for (const a of args.slice(1)) {
          const range = functionRange(a.trim(), content, lang);
          if (range) ranges.push(range);
        }
        out.push({
          index: lineIndexOf(content, m.index),
          names: new Set([id]),
          receivers: new Set(),
          ranges,
          kind: "queue worker",
        });
      }
    }

    SQS_CONSUMER.lastIndex = 0;
    while ((m = SQS_CONSUMER.exec(content)) && out.length < MAX_REGISTRATIONS) {
      const open = m.index + m[0].length - 1;
      const { args, end } = splitArgs(content.slice(open, open + ARG_WINDOW), 0);
      const names = new Set<string>();
      QUEUE_URL_PROP.lastIndex = 0;
      let q: RegExpExecArray | null;
      while ((q = QUEUE_URL_PROP.exec(args.join(",")))) {
        const id = jobIdentity(q[1] ?? "", consts);
        if (id !== null) names.add(id);
      }
      if (names.size === 0) continue;
      out.push({
        index: lineIndexOf(content, m.index),
        names,
        receivers: new Set(),
        ranges: [[open, open + end + 1]],
        kind: "queue consumer",
      });
    }
    return out;
  }

  // Celery: the decorator marks the handler; the job's name is the function's unless overridden.
  const lines = content.split(/\r?\n/);
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  lines.forEach((line, i) => {
    if (out.length >= MAX_REGISTRATIONS) return;
    const d = /^\s*@\s*(?:[\w.]+\.)?(task|shared_task|periodic_task)\b(.*)$/.exec(line);
    if (!d) return;
    let j = i + 1;
    while (j < lines.length && j - i < 12 && !/^\s*(?:async\s+)?def\s+\w+\s*\(/.test(lines[j] ?? "")) j++;
    const def = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[j] ?? "");
    if (!def) return;
    const names = new Set<string>(["s:" + def[1]!, "i:" + def[1]!]);
    const named = /\bname\s*=\s*(["'])([^"']+)\1/.exec(d[2] ?? "");
    if (named) names.add("s:" + named[2]!);
    const start = offsets[j + 1] ?? offsets[j] ?? 0;
    out.push({
      index: lineIndexOf(content, offsets[i] ?? 0),
      names,
      receivers: new Set([def[1]!, "self"]),
      ranges: [[start, start + pythonSuite(lines, j).length]],
      kind: "task worker",
    });
  });
  return out;
}

interface RequeueSite {
  index: number;
  job: string;
  kind: string;
}

/**
 * Every enqueue-shaped call in the file, resolved once. Registrations then match against this
 * list by set lookup, so N registrations cost N × edges rather than N × file.
 */
function enqueueCandidates(content: string, lang: Lang, consts: Map<string, string>): Edge[] {
  const edges: Edge[] = [];
  let m: RegExpExecArray | null;

  if (lang === "php") {
    ENQUEUE_BY_STATIC.lastIndex = 0;
    while ((m = ENQUEUE_BY_STATIC.exec(content)) && edges.length < MAX_EDGES) {
      edges.push({ offset: m.index, identity: null, receiver: m[1]! });
    }
    ENQUEUE_BY_NEW.lastIndex = 0;
    while ((m = ENQUEUE_BY_NEW.exec(content)) && edges.length < MAX_EDGES) {
      const cls = m[1]!.split("\\").pop() ?? m[1]!;
      edges.push({ offset: m.index, identity: null, receiver: cls });
    }
    return edges;
  }

  ENQUEUE_BY_ARG.lastIndex = 0;
  while ((m = ENQUEUE_BY_ARG.exec(content)) && edges.length < MAX_EDGES) {
    const open = m.index + m[0].length - 1;
    const args = windowedArgs(content, open);
    const first = jobIdentity(args[0] ?? "", consts);
    if (first !== null) {
      edges.push({ offset: m.index, identity: first, receiver: null });
      continue;
    }
    // The destination can be a queue URL buried in an SDK command object.
    QUEUE_URL_PROP.lastIndex = 0;
    let q: RegExpExecArray | null;
    while ((q = QUEUE_URL_PROP.exec(args.join(",")))) {
      const id = jobIdentity(q[1] ?? "", consts);
      if (id === null) continue;
      edges.push({ offset: m.index, identity: id, receiver: null });
      break;
    }
  }

  ENQUEUE_BY_RECEIVER.lastIndex = 0;
  while ((m = ENQUEUE_BY_RECEIVER.exec(content)) && edges.length < MAX_EDGES * 2) {
    edges.push({ offset: m.index, identity: null, receiver: m[1]! });
  }

  return edges;
}

function matches(edge: Edge, reg: Registration): boolean {
  if (edge.identity !== null && reg.names.has(edge.identity)) return true;
  return edge.receiver !== null && reg.receivers.has(edge.receiver);
}

function findSelfRequeue(content: string, lang: Lang): RequeueSite[] {
  if (looksGenerated(content)) return [];
  /* Rust's queue ecosystem (lapin, rdkafka, faktory, apalis) registers handlers in ways none of
     the patterns above describe, and guessing at them would be inventing behaviour rather than
     modelling it. Rust iteration is covered by the recursion pass below instead. */
  if (lang === "rust") return [];
  const consts = stringConstants(content);
  const regs = findRegistrations(content, lang, consts);
  const temporal = lang !== "py" && TEMPORAL_EVIDENCE.test(content);
  if (regs.length === 0 && !temporal) return [];
  // A depth/attempt cap, or a framework retry ceiling, bounds the chain.
  if (ATTEMPT_GUARD.test(content) || RETRY_CAP.test(content)) return [];

  const sites: RequeueSite[] = [];
  const seen = new Set<number>();
  const add = (line: number, job: string, kind: string) => {
    if (seen.has(line)) return;
    seen.add(line);
    sites.push({ index: line, job, kind });
  };

  const edges = regs.length > 0 ? enqueueCandidates(content, lang, consts) : [];
  for (const reg of regs) {
    const own = edges.filter((e) => matches(e, reg) && reg.ranges.some(([a, b]) => e.offset >= a && e.offset < b));
    // Prefer the handler body; fall back to the whole file when the back edge lives in a helper.
    const hits = own.length > 0 ? own : edges.filter((e) => matches(e, reg));
    for (const e of hits) {
      add(lineIndexOf(content, e.offset), e.identity !== null ? displayJob(e.identity) : (e.receiver ?? ""), reg.kind);
    }
  }

  if (temporal) {
    CONTINUE_AS_NEW.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CONTINUE_AS_NEW.exec(content))) {
      add(lineIndexOf(content, m.index), "this workflow", "workflow");
    }
  }

  return sites;
}

/* ── 5. Iteration with no loop keyword: the self-recursive step function ─────────────── */

/**
 * A function that calls itself is iterating. The function body is the loop body and the
 * self-call is the back edge — §1 is blind to it because there is no loop keyword anywhere.
 *
 * This is not a Rust curiosity, but Rust is where it is idiomatic enough to be the default:
 * `async fn` cannot recurse directly (the future would be infinitely sized), so an async agent
 * step is written `fn drive(s) -> Pin<Box<dyn Future<…>>> { Box::pin(async move { … drive(s).await }) }`,
 * or with `#[async_recursion]`. Either way each step is its own future and there is no loop.
 * The same shape appears as a trampolining `step()` in JS and a recursive `plan()` in Python.
 *
 * The bound question is completely unchanged: `analyseBound` runs on the function body exactly
 * as it does on a loop body, so a budget the model can reset is caught here for the same reason
 * it is caught in a `while (true)` — including the mirror-image spelling, a budget that counts
 * down and is reassigned upward when a tool asks for more room.
 *
 * What this deliberately does not attempt is mutual recursion (`plan()` calls `act()` calls
 * `plan()`), which needs a call graph across functions and files.
 */
const MAX_FUNCTIONS = 400;

const FN_DEF: Record<Lang, RegExp> = {
  rust: /\bfn\s+(\w+)\s*(?:<[^<>()\n]{0,120}>)?\s*\(/g,
  go: /\bfunc\s+(?:\([^)\n]*\)\s*)?(\w+)\s*\(/g,
  php: /\bfunction\s+(\w+)\s*\(/g,
  py: /^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(/gm,
  js: /(?:async\s+)?function\s*\*?\s*(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*(?::[^=\n]{0,120})?=\s*(?:async\s+)?(?:function\b|\([^()\n]{0,200}\)\s*(?::[^=>\n]{0,80})?=>)/g,
};

function findRecursion(content: string, lang: Lang): LoopSite[] {
  if (looksGenerated(content)) return [];
  const out: LoopSite[] = [];

  if (lang === "py") {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (out.length >= MAX_FUNCTIONS) return;
      const m = /^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(/.exec(line);
      if (!m) return;
      const body = pythonSuite(lines, i);
      if (!callsItself(m[1]!, body)) return;
      out.push({ index: i, header: line, body, kind: "self-recursive call" });
    });
    return out;
  }

  const re = FN_DEF[lang];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) && out.length < MAX_FUNCTIONS) {
    const name = m[1] ?? m[2];
    if (!name) continue;
    // The parameter list, then the body brace after it. Taking the first `{` from the name
    // instead would land inside an object type annotation or a Rust `-> impl Trait` bound.
    const paren = content.indexOf("(", m.index);
    if (paren < 0) break;
    const { end } = splitArgs(content.slice(paren), 0);
    const afterParams = paren + end;
    const open = content.indexOf("{", afterParams);
    if (open < 0 || open - afterParams > 400) continue;
    const body = content.slice(open, matchBrace(content, open, lang) + 1);
    if (!callsItself(name, body)) continue;
    out.push({
      index: lineIndexOf(content, m.index),
      header: content.slice(m.index, open),
      body,
      kind: "self-recursive call",
    });
  }
  return out;
}

/** `drive(session)`, `self.drive(…)`, `Self::drive(…)`, `drive::<T>(…)` inside its own body. */
function callsItself(name: string, body: string): boolean {
  if (name.length < 2) return false;
  return new RegExp(`\\b${name.replace(/[$]/g, "\\$&")}\\s*(?:::\\s*<[^<>()\\n]{0,80}>\\s*)?\\(`).test(body);
}

/* ── Detector ────────────────────────────────────────────────────────────────────────── */

function surfaceOf(file: ScanFile): Surface {
  if (file.surfaces.includes("agent_code")) return "agent_code";
  if (file.surfaces.includes("mcp_server")) return "mcp_server";
  return "app_code";
}

export const overPermissionedLoopDetector: Detector = {
  classIds: ["over-permissioned-loop"],
  tier: "research",
  run(ctx: ScanContext): DetectorFinding[] {
    const findings: DetectorFinding[] = [];

    for (const file of ctx.files) {
      const lang = langOf(file.relPath);
      if (!lang) continue;
      const content = blankComments(file.content, lang);
      const lines = content.split(/\r?\n/);
      /* A recursive function whose body already contains a reported loop is one runaway, not
         two — report the inner construct and let the recursion pass stay quiet. */
      const reportedLines: number[] = [];

      for (const loop of [...findLoops(content, lang), ...findRecursion(content, lang)]) {
        if (!drivesAgent(loop.body)) continue;
        const bodyLines = loop.body.split("\n").length;
        if (
          loop.kind === "self-recursive call" &&
          reportedLines.some((l) => l >= loop.index && l < loop.index + bodyLines)
        ) {
          continue;
        }
        // Enclosing-scope window: where a timeout would have been installed before the loop.
        const scopeBefore = lines.slice(Math.max(0, loop.index - 40), loop.index).join("\n");
        const verdict = analyseBound(loop, scopeBefore);
        if (verdict.bounded) continue;
        reportedLines.push(loop.index);

        const line = loop.index + 1;
        const detail = verdict.defeated
          ? `Its step budget (\`${verdict.defeated.counter}\`) is reset inside the loop (\`${verdict.defeated.line}\`) ` +
            `on data that comes back from a tool, so the model can renew its own budget indefinitely — the cap ` +
            `never binds.`
          : `It has no iteration cap, no wall-clock deadline, no cost ceiling and no human approval gate. Any ` +
            `\`break\`/\`return\` present is decided by the model's own output, which is exactly the behaviour ` +
            `the bound is supposed to contain.`;
        const construct =
          loop.kind === "self-recursive call"
            ? `a function that calls itself — iteration with no loop keyword, one step per future`
            : `a \`${loop.kind}\``;
        findings.push({
          tier: "research",
          classId: "over-permissioned-loop",
          severity: "high",
          surfaces: file.surfaces,
          locations: [{ path: file.relPath, startLine: line, endLine: line, surface: surfaceOf(file) }],
          explanation:
            `${file.relPath}:${line} drives a model/tool agent inside ${construct} with no effective bound. ` +
            `${detail} Add a bound the model cannot influence — a step cap that is never reset, a deadline, or a ` +
            `spend ceiling — and scope the tools the loop may reach.`,
          confidence: verdict.defeated ? 0.7 : 0.66,
        });
      }

      // Iteration with no loop keyword: a job handler that re-enqueues its own job type.
      for (const site of findSelfRequeue(content, lang)) {
        const line = site.index + 1;
        const selfNamed = site.job === "self" || site.job === "static" || site.job === "this";
        const what =
          site.kind === "workflow"
            ? `continues as new, so each run schedules its own next run`
            : selfNamed
              ? `dispatches this same ${site.kind} again, so each run schedules its own next run`
              : `re-enqueues the job "${site.job}" that this same ${site.kind} handles, so each run schedules its ` +
                `own next run`;
        findings.push({
          tier: "research",
          classId: "over-permissioned-loop",
          severity: "high",
          surfaces: file.surfaces,
          locations: [{ path: file.relPath, startLine: line, endLine: line, surface: surfaceOf(file) }],
          explanation:
            `${file.relPath}:${line} ${what}. That is an unbounded agent loop with no loop keyword: there is no ` +
            `depth or generation counter carried on the payload and compared against a cap, and no deadline. A ` +
            `per-attempt retry ceiling or timeout does not bound the chain — each link succeeds, so it never ` +
            `retries. Carry a depth count on the job payload and refuse to re-enqueue past a cap.`,
          confidence: 0.62,
        });
      }
    }

    return findings;
  },
};
