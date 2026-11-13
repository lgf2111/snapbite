import { ExternalLink } from './ExternalLink.js';
import {
  ACCENT,
  HelpAccordion,
  HelpFigure,
  MUTED,
  MockBrowser,
  SURFACE,
  Step,
  TEXT,
} from './HelpAccordion.js';

/** Fallbacks for the delete/replace section. */
function KeyMenuPanel() {
  return (
    <svg
      viewBox="0 0 360 160"
      className="w-full"
      role="img"
      aria-label="API key row with the three-dot menu open"
    >
      <rect width="360" height="160" fill="#0b1219" />
      <rect x="16" y="22" width="328" height="112" rx="10" fill={SURFACE} stroke="#22303d" />
      <text x="32" y="46" fontSize="9" fill={ACCENT} fontFamily="monospace">
        …By0Q
      </text>
      <text x="32" y="60" fontSize="7.5" fill={MUTED} fontFamily="system-ui, sans-serif">
        SnapBite
      </text>
      <circle cx="300" cy="44" r="2" fill={MUTED} />
      <circle cx="300" cy="50" r="2" fill={MUTED} />
      <circle cx="300" cy="56" r="2" fill={MUTED} />
      <rect x="248" y="66" width="92" height="52" rx="8" fill="#16222e" stroke="#2b3947" />
      <text x="260" y="86" fontSize="8" fill={TEXT} fontFamily="system-ui, sans-serif">
        Rename key
      </text>
      <text x="260" y="106" fontSize="8" fill="#ff7b72" fontFamily="system-ui, sans-serif">
        Delete key
      </text>
    </svg>
  );
}

function DeleteDialogPanel() {
  return (
    <svg
      viewBox="0 0 360 170"
      className="w-full"
      role="img"
      aria-label="Delete API key confirmation"
    >
      <rect width="360" height="170" fill="#0b1219" />
      <rect x="20" y="26" width="320" height="118" rx="12" fill={SURFACE} stroke="#22303d" />
      <text x="36" y="52" fontSize="9.5" fill={TEXT} fontFamily="system-ui, sans-serif">
        Delete API key?
      </text>
      <text x="36" y="70" fontSize="7" fill={MUTED} fontFamily="system-ui, sans-serif">
        Apps or services using this key will stop working.
      </text>
      <text x="36" y="82" fontSize="7" fill={MUTED} fontFamily="system-ui, sans-serif">
        This action cannot be undone.
      </text>
      <text x="228" y="126" fontSize="8" fill={MUTED} fontFamily="system-ui, sans-serif">
        Cancel
      </text>
      <rect x="272" y="112" width="56" height="20" rx="10" fill="#b3261e" />
      <text
        x="300"
        y="126"
        fontSize="8"
        fill="#fff"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
      >
        Delete
      </text>
    </svg>
  );
}

/** Minimal fallbacks — only shown until the real screenshot loads. */
function SignInPanel() {
  return (
    <svg viewBox="0 0 360 200" className="w-full" role="img" aria-label="Google sign-in page">
      <rect width="360" height="200" fill="#0b1219" />
      <text
        x="180"
        y="52"
        fontSize="18"
        fill={TEXT}
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
      >
        G
      </text>
      <text
        x="180"
        y="82"
        fontSize="11"
        fill={TEXT}
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
      >
        Sign in
      </text>
      <text
        x="180"
        y="98"
        fontSize="7.5"
        fill={MUTED}
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
      >
        Use your Google Account
      </text>
      <rect x="60" y="118" width="240" height="22" rx="6" fill={SURFACE} stroke="#2b3947" />
      <text x="72" y="133" fontSize="7.5" fill={MUTED} fontFamily="system-ui, sans-serif">
        Email or phone
      </text>
      <rect x="240" y="152" width="60" height="20" rx="10" fill={ACCENT} />
      <text
        x="270"
        y="166"
        fontSize="8"
        fill="#06121f"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
      >
        Next
      </text>
    </svg>
  );
}

function ProjectPickerPanel() {
  return (
    <svg
      viewBox="0 0 360 200"
      className="w-full"
      role="img"
      aria-label="Create a new key dialog with project dropdown"
    >
      <rect width="360" height="200" fill="#0b1219" />
      <rect x="24" y="22" width="312" height="156" rx="12" fill={SURFACE} stroke="#22303d" />
      <text x="40" y="46" fontSize="9.5" fill={TEXT} fontFamily="system-ui, sans-serif">
        Create a new key
      </text>
      <text x="40" y="64" fontSize="7" fill={MUTED} fontFamily="system-ui, sans-serif">
        Name your key
      </text>
      <rect x="40" y="68" width="280" height="18" rx="6" fill="#0b1219" stroke="#2b3947" />
      <text x="50" y="81" fontSize="7.5" fill={TEXT} fontFamily="system-ui, sans-serif">
        Gemini API Key
      </text>
      <text x="40" y="102" fontSize="7" fill={MUTED} fontFamily="system-ui, sans-serif">
        Choose an imported project
      </text>
      <rect x="40" y="106" width="280" height="18" rx="6" fill="#0b1219" stroke={ACCENT} />
      <text x="50" y="119" fontSize="7.5" fill={TEXT} fontFamily="system-ui, sans-serif">
        SnapBite
      </text>
      <text x="50" y="136" fontSize="7.5" fill={ACCENT} fontFamily="system-ui, sans-serif">
        Import project
      </text>
      <text x="50" y="150" fontSize="7.5" fill={ACCENT} fontFamily="system-ui, sans-serif">
        + Create project
      </text>
      <rect x="250" y="156" width="70" height="18" rx="9" fill={ACCENT} />
      <text
        x="285"
        y="169"
        fontSize="7.5"
        fill="#06121f"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
      >
        Create key
      </text>
    </svg>
  );
}

function KeyDetailsPanel() {
  return (
    <svg
      viewBox="0 0 360 200"
      className="w-full"
      role="img"
      aria-label="API key details with copy icon"
    >
      <rect width="360" height="200" fill="#0b1219" />
      <rect x="20" y="24" width="320" height="150" rx="12" fill={SURFACE} stroke="#22303d" />
      <text x="36" y="48" fontSize="9.5" fill={TEXT} fontFamily="system-ui, sans-serif">
        API key details
      </text>
      <text x="36" y="72" fontSize="7" fill={MUTED} fontFamily="system-ui, sans-serif">
        API Key
      </text>
      <text x="36" y="88" fontSize="7.5" fill={TEXT} fontFamily="monospace">
        AQ.Ab8RN6••••••••••••
      </text>
      <rect x="286" y="78" width="14" height="14" rx="3" fill="none" stroke={ACCENT} />
      <rect x="290" y="74" width="14" height="14" rx="3" fill="none" stroke={ACCENT} />
      <circle cx="300" cy="84" r="16" fill="none" stroke="#ffd166" strokeDasharray="3 3" />
      <text x="36" y="118" fontSize="6.5" fill={MUTED} fontFamily="system-ui, sans-serif">
        Tap the copy icon — then paste it back in SnapBite.
      </text>
    </svg>
  );
}

/** Diagram: the project picker that appears when a key has no project yet. */
function ProjectPanel() {
  return (
    <svg
      viewBox="0 0 360 200"
      className="w-full"
      role="img"
      aria-label="Create a project for the API key"
    >
      <rect width="360" height="200" fill="#0b1219" />
      <rect x="24" y="22" width="312" height="156" rx="12" fill={SURFACE} stroke="#22303d" />
      <text x="40" y="46" fontSize="9.5" fill={TEXT} fontFamily="system-ui, sans-serif">
        Create an API key
      </text>
      <text x="40" y="64" fontSize="7.5" fill={MUTED} fontFamily="system-ui, sans-serif">
        A key belongs to a project.
      </text>

      {/* project choice */}
      <circle cx="46" cy="86" r="6" fill={ACCENT} />
      <text x="60" y="90" fontSize="8" fill={TEXT} fontFamily="system-ui, sans-serif">
        Create a new project
      </text>
      <rect x="60" y="98" width="150" height="18" rx="6" fill="#0b1219" stroke="#2b3947" />
      <text x="70" y="111" fontSize="7.5" fill={TEXT} fontFamily="system-ui, sans-serif">
        SnapBite
      </text>

      <circle cx="46" cy="134" r="6" fill="none" stroke={MUTED} />
      <text x="60" y="138" fontSize="8" fill={MUTED} fontFamily="system-ui, sans-serif">
        Use an existing project
      </text>

      {/* optional org */}
      <text x="40" y="160" fontSize="7" fill={MUTED} fontFamily="system-ui, sans-serif">
        Organisation — optional, leave as “No organisation”
      </text>

      <rect x="236" y="150" width="84" height="20" rx="10" fill={ACCENT} />
      <text x="258" y="164" fontSize="8" fill="#06121f" fontFamily="system-ui, sans-serif">
        Create
      </text>
    </svg>
  );
}

/** Diagram: the AI Studio panel with the create button highlighted. */
function StudioPanel() {
  return (
    <svg viewBox="0 0 360 200" className="w-full" role="img" aria-label="AI Studio keys page">
      <rect width="360" height="200" fill="#0b1219" />
      <rect x="0" y="0" width="360" height="24" fill="#1a242f" />
      <text x="12" y="16" fontSize="8" fill={TEXT} fontFamily="system-ui, sans-serif">
        Google AI Studio
      </text>
      <text x="18" y="48" fontSize="10" fill={TEXT} fontFamily="system-ui, sans-serif">
        API keys
      </text>
      {/* highlighted create button */}
      <rect x="250" y="34" width="92" height="20" rx="10" fill={ACCENT} />
      <text x="262" y="48" fontSize="8" fill="#06121f" fontFamily="system-ui, sans-serif">
        Create API key
      </text>
      <rect
        x="250"
        y="26"
        width="100"
        height="36"
        rx="12"
        fill="none"
        stroke="#ffd166"
        strokeDasharray="4 3"
      />
      {/* key list */}
      <rect x="18" y="72" width="324" height="46" rx="8" fill={SURFACE} stroke="#22303d" />
      <text x="30" y="90" fontSize="8" fill={MUTED} fontFamily="system-ui, sans-serif">
        Default Gemini project
      </text>
      <text x="30" y="106" fontSize="9" fill={TEXT} fontFamily="ui-monospace, monospace">
        AIzaSy••••••••••••••••••••••
      </text>
      <rect x="266" y="86" width="60" height="18" rx="9" fill="none" stroke={ACCENT} />
      <text x="286" y="98" fontSize="8" fill={ACCENT} fontFamily="system-ui, sans-serif">
        Copy
      </text>
      <text x="18" y="140" fontSize="7.5" fill={MUTED} fontFamily="system-ui, sans-serif">
        Key stays hidden after creation — copy it then.
      </text>
    </svg>
  );
}

/** Diagram: where the key goes once copied. */
function PasteDiagram() {
  return (
    <svg
      viewBox="0 0 360 140"
      className="w-full"
      role="img"
      aria-label="Paste the key into SnapBite"
    >
      <rect width="360" height="140" fill="#0b1219" />
      <text x="16" y="24" fontSize="9" fill={TEXT} fontFamily="system-ui, sans-serif">
        Back in SnapBite
      </text>
      <text x="16" y="44" fontSize="8" fill={MUTED} fontFamily="system-ui, sans-serif">
        API key
      </text>
      <rect x="16" y="52" width="328" height="28" rx="8" fill="none" stroke="#2b3947" />
      <text x="28" y="70" fontSize="9" fill={TEXT} fontFamily="ui-monospace, monospace">
        AIzaSy••••••••••••••••
      </text>
      <rect x="16" y="92" width="328" height="30" rx="15" fill={ACCENT} />
      <text x="140" y="111" fontSize="9" fill="#06121f" fontFamily="system-ui, sans-serif">
        Save key and finish
      </text>
    </svg>
  );
}

/**
 * Help for the "add your AI key" step.
 *
 * Written for someone who has never created an API key: numbered actions, one
 * idea per step, and a picture of what they should be looking at. Screenshots
 * live at /help/ai-studio-*.png — drop real captures there and they replace the
 * diagrams automatically.
 */
export function KeyHelp() {
  return (
    <HelpAccordion
      items={[
        {
          title: 'Get a free Gemini key (6 steps)',
          summary: 'About 3 minutes, free, no card needed',
          children: (
            <div className="flex flex-col gap-4">
              <ol className="flex flex-col gap-4">
                <Step n={1} title="Sign in to Google — any normal Gmail works">
                  <p className="text-muted-foreground text-caption">
                    It is free, and you do not need a work or school account.
                  </p>
                  <HelpFigure
                    src="/help/ai-studio-1.png"
                    alt="Google sign-in page: Sign in, Use your Google Account, Email or phone field, Next"
                    caption="The ordinary Google sign-in — the same one as Gmail."
                    fallback={<SignInPanel />}
                  />
                </Step>

                <Step n={2} title="Open Google AI Studio">
                  <ExternalLink
                    href="https://aistudio.google.com/apikey"
                    className="text-primary-text text-caption break-all underline underline-offset-2"
                  >
                    aistudio.google.com/apikey
                  </ExternalLink>
                  <p className="text-muted-foreground text-caption">
                    This is the <strong className="text-foreground">API Keys</strong> page. The
                    button you need is top right.
                  </p>
                  <HelpFigure
                    src="/help/ai-studio-2.png"
                    alt="AI Studio API Keys page with the Create API key button at the top right"
                    caption="API Keys page — press “Create API key”."
                    fallback={<StudioPanel />}
                  />
                </Step>

                <Step n={3} title="Press “Create API key”, then pick a project">
                  <p className="text-muted-foreground text-caption">
                    A box opens asking for a <strong className="text-foreground">key name</strong>{' '}
                    and a <strong className="text-foreground">project</strong>. Leave the key name
                    as it is — it is only a label.
                  </p>
                  <p className="text-muted-foreground text-caption">
                    Press the project dropdown. If your project is already listed, pick it and go to
                    step 5.
                  </p>
                  <HelpFigure
                    src="/help/ai-studio-3.png"
                    alt="Create a new key dialog with a name field and a project dropdown showing Import project and Create project"
                    caption="No project yet? Choose “Create project” at the bottom of that list."
                    fallback={<ProjectPickerPanel />}
                  />
                </Step>

                <Step n={4} title="Create the project (only if you had none)">
                  <p className="text-muted-foreground text-caption">
                    Name it anything — <code className="font-mono">SnapBite</code> is fine. Press{' '}
                    <strong className="text-foreground">Create project</strong> and wait for “New
                    project created!”.
                  </p>
                  <p className="text-muted-foreground text-caption">
                    <strong className="text-foreground">Organisation is optional</strong> — ignore
                    it unless a company gave you one. Nothing here costs money.
                  </p>
                  <HelpFigure
                    src="/help/ai-studio-4.png"
                    alt="Create a new project dialog with a Name your project field, Cancel and Create project"
                    caption="Type a name, then press “Create project”."
                    fallback={<ProjectPanel />}
                  />
                </Step>

                <Step n={5} title="Copy the key">
                  <p className="text-muted-foreground text-caption">
                    After the key is created, an{' '}
                    <strong className="text-foreground">API key details</strong> box appears. The
                    key starts <code className="font-mono">AQ.</code> (older ones start{' '}
                    <code className="font-mono">AIza</code>) — that is normal.
                  </p>
                  <p className="text-muted-foreground text-caption">
                    Tap the <strong className="text-foreground">copy icon</strong> beside it.
                  </p>
                  <p className="text-caption text-warning">
                    Copy it now. Close the box without copying and you will have to delete the key
                    and make a new one.
                  </p>
                  <HelpFigure
                    src="/help/ai-studio-5.png"
                    alt="API key details box showing the API Key field with a copy icon"
                    caption="The copy icon sits to the right of the key."
                    fallback={<KeyDetailsPanel />}
                  />
                </Step>

                <Step n={6} title="Come back here, paste it, and save">
                  <p className="text-muted-foreground text-caption">
                    Long-press the API key box above → Paste. Then press{' '}
                    <strong className="text-foreground">Save key and finish</strong>.
                  </p>
                  <HelpFigure
                    src="/help/ai-studio-paste.png"
                    alt="SnapBite onboarding with the key pasted"
                    caption="The key box is directly above this help panel."
                    fallback={<PasteDiagram />}
                  />
                </Step>
              </ol>

              <p className="text-muted-foreground text-caption">
                Stuck? Skip this step — you can still log meals by hand, and add the key later in
                Settings.
              </p>
            </div>
          ),
        },
        {
          title: 'I have no project yet — what do I pick?',
          summary: 'A key always lives inside a project; here is the short version',
          children: (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-caption">
                A Gemini key belongs to a Google Cloud project. If you have never made one, AI
                Studio makes it for you — you do not have to visit the Cloud console.
              </p>
              <ol className="flex flex-col gap-2 text-caption">
                <li className="flex gap-2">
                  <span className="text-primary-text">1.</span>
                  <span>
                    Press <strong className="text-foreground">Create API key</strong>.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary-text">2.</span>
                  <span>
                    In the project dropdown choose{' '}
                    <strong className="text-foreground">+ Create project</strong> (it is the bottom
                    item in the list).
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary-text">3.</span>
                  <span>
                    Type a name — <code className="font-mono">SnapBite</code> works — and press{' '}
                    <strong className="text-foreground">Create project</strong>. Wait for “New
                    project created!”.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary-text">4.</span>
                  <span>Press Create key. Your key now belongs to that project.</span>
                </li>
              </ol>
              <p className="text-muted-foreground text-caption">
                <strong className="text-foreground">Organisation is optional.</strong> If a screen
                asks for one, choose <em>No organisation</em>. You do not need a company account,
                and a free project costs nothing.
              </p>
              <p className="text-muted-foreground text-caption">
                Prefer the Cloud console instead?{' '}
                <ExternalLink
                  href="https://console.cloud.google.com/projectcreate"
                  className="text-primary-text underline underline-offset-2"
                >
                  console.cloud.google.com/projectcreate
                </ExternalLink>{' '}
                — then go back to AI Studio and press the refresh icon next to the project dropdown.
              </p>
            </div>
          ),
        },
        {
          title: 'How do I delete or replace my key?',
          summary: 'Delete the old one, make a new one, paste it into Settings',
          children: (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-caption">
                Do this if a key leaked, or if you want to move to another project. In SnapBite the
                new key goes in <strong className="text-foreground">Settings → AI key</strong>.
              </p>

              <div className="flex flex-col gap-2">
                <p className="text-foreground text-body font-medium">Delete a key</p>
                <ol className="flex flex-col gap-2 text-caption">
                  <li className="flex gap-2">
                    <span className="text-primary-text">1.</span>
                    <span>
                      Open{' '}
                      <ExternalLink
                        href="https://aistudio.google.com/apikey"
                        className="text-primary-text underline underline-offset-2"
                      >
                        aistudio.google.com/apikey
                      </ExternalLink>{' '}
                      and find the key in the list.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary-text">2.</span>
                    <span>
                      Tap the <strong className="text-foreground">⋮</strong> (three dots) at the
                      right of the key's row.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary-text">3.</span>
                    <span>
                      Choose <strong className="text-foreground">Delete key</strong>, then{' '}
                      <strong className="text-foreground">Delete</strong> on the warning.
                    </span>
                  </li>
                </ol>
                <HelpFigure
                  src="/help/ai-studio-6.png"
                  alt="API key row with the three-dot menu open showing Rename key and Delete key"
                  caption="The ⋮ menu on the key row — Delete key is the second item."
                  fallback={<KeyMenuPanel />}
                />
                <p className="text-caption text-warning">
                  Deleting is immediate and cannot be undone. Anything still using that key stops
                  working, including SnapBite until you paste a new one.
                </p>
              </div>

              <HelpFigure
                src="/help/ai-studio-7.png"
                alt="Delete API key confirmation dialog: Apps or services using this key will stop working, with Cancel and Delete"
                caption="The warning — press “Delete” only once you have a replacement ready."
                fallback={<DeleteDialogPanel />}
              />

              <div className="flex flex-col gap-2">
                <p className="text-foreground text-body font-medium">Replace it</p>
                <ol className="flex flex-col gap-2 text-caption">
                  <li className="flex gap-2">
                    <span className="text-primary-text">1.</span>
                    <span>
                      Make a new key first — press Create API key, exactly as in the steps above.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary-text">2.</span>
                    <span>Copy it, then paste it into SnapBite → Settings → AI key and save.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary-text">3.</span>
                    <span>Only after SnapBite works with the new key, delete the old one.</span>
                  </li>
                </ol>
                <p className="text-muted-foreground text-caption">
                  In that order you never lose meal logging. Doing it the other way round means
                  photo logging fails until you finish.
                </p>
              </div>
            </div>
          ),
        },
        {
          title: 'What does it cost?',
          summary: 'Free for normal use',
          children: (
            <div className="text-muted-foreground flex flex-col gap-2 text-caption">
              <p>
                The key is yours, and Google bills it — not SnapBite. Gemini has a free tier that
                covers a few dozen meal photos a day.
              </p>
              <p>
                If you ever go over it, one photo costs a fraction of a cent. Nothing here charges
                you.
              </p>
            </div>
          ),
        },
        {
          title: 'Is the key safe?',
          summary: 'Encrypted, never shown again',
          children: (
            <div className="text-muted-foreground flex flex-col gap-2 text-caption">
              <p>
                The key is encrypted before it is stored, is only decrypted for the moment a photo
                is analyzed, and is never sent back to the screen or written to logs.
              </p>
              <p>
                You can replace or delete it any time in Settings. Deleting your account deletes it.
              </p>
            </div>
          ),
        },
        {
          title: 'Which provider should I pick?',
          summary: 'Gemini is the easiest',
          children: (
            <div className="text-muted-foreground flex flex-col gap-2 text-caption">
              <p>
                <strong className="text-foreground">Gemini</strong> — free key, works immediately.
                Best choice if you are unsure.
              </p>
              <p>
                <strong className="text-foreground">OpenAI</strong> and{' '}
                <strong className="text-foreground">DeepSeek</strong> work too, but both need a paid
                account with a card on file.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}
