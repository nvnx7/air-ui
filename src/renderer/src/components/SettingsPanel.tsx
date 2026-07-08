export type TrackerMode = 'head' | 'finger' | 'gaze' | 'combined'

export interface Gesture {
  id: string
  name: string
  description: string
  action: string
}

export interface ActionInfo {
  id: string
  label: string
}

const MODE_LABEL: Record<TrackerMode, string> = {
  head: 'Head',
  finger: 'Finger',
  gaze: 'Eyes (experimental)',
  combined: 'Head + Finger (precise)'
}

interface Props {
  onClose: () => void

  trackerMode: TrackerMode
  onTrackerModeChange: (m: TrackerMode) => void

  sensitivityX: number
  onSensitivityXChange: (n: number) => void
  sensitivityY: number
  onSensitivityYChange: (n: number) => void
  fineSensitivity: number
  onFineSensitivityChange: (n: number) => void

  invertX: boolean
  onInvertXChange: (b: boolean) => void
  invertY: boolean
  onInvertYChange: (b: boolean) => void

  accelerationEnabled: boolean
  onAccelerationChange: (b: boolean) => void

  dwellFrames: number
  onDwellFramesChange: (n: number) => void

  onRecenter: () => void
  recenterDisabled: boolean
  centeredFlash: boolean

  gesturesEnabled: boolean
  gestures: Gesture[]
  actions: ActionInfo[]
  onDeleteGesture: (id: string) => void

  teaching: boolean
  teachBusy: boolean
  teachDescription: string
  onTeachDescriptionChange: (s: string) => void
  teachName: string
  onTeachNameChange: (s: string) => void
  teachAction: string
  onTeachActionChange: (s: string) => void
  onStartTeach: () => void
  onSaveTeach: () => void
  onCancelTeach: () => void
}

function SettingsPanel(props: Props): React.JSX.Element {
  const actionLabel = (id: string): string =>
    props.actions.find((a) => a.id === id)?.label ?? id

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-xl bg-zinc-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={props.onClose}
            className="rounded-lg px-3 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            ✕ Close
          </button>
        </div>

        {/* Tracker mode */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-zinc-600">Tracker</span>
          <div className="flex w-fit flex-wrap gap-1 rounded-lg bg-zinc-950 p-1 text-sm">
            {(Object.keys(MODE_LABEL) as TrackerMode[]).map((m) => (
              <button
                key={m}
                onClick={() => props.onTrackerModeChange(m)}
                className={`rounded-md px-3 py-1 ${
                  props.trackerMode === m ? 'bg-indigo-600 text-white' : 'text-zinc-400'
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {props.trackerMode === 'gaze' && (
            <span className="text-xs text-amber-400">
              Eye tracking is coarse (webcam gaze estimation is inherently imprecise) — expect
              jitter. Increase sensitivity carefully and Recenter often.
            </span>
          )}
          {props.trackerMode === 'combined' && (
            <span className="text-xs text-zinc-500">
              Head aims coarsely; raise your finger to nudge the cursor precisely within a small
              local area. Drop your hand to go back to head-only.
            </span>
          )}
        </div>

        {/* Sliders (duplicated from the main screen for full access here too) */}
        <label className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="w-32">{props.trackerMode === 'combined' ? 'Head H' : 'Horizontal'}</span>
          <input
            type="range"
            min={1}
            max={12}
            step={0.5}
            value={props.sensitivityX}
            onChange={(e) => props.onSensitivityXChange(parseFloat(e.target.value))}
          />
          <span className="w-10 tabular-nums">{props.sensitivityX.toFixed(1)}</span>
        </label>

        <label className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="w-32">{props.trackerMode === 'combined' ? 'Head V' : 'Vertical'}</span>
          <input
            type="range"
            min={1}
            max={12}
            step={0.5}
            value={props.sensitivityY}
            onChange={(e) => props.onSensitivityYChange(parseFloat(e.target.value))}
          />
          <span className="w-10 tabular-nums">{props.sensitivityY.toFixed(1)}</span>
        </label>

        {props.trackerMode === 'combined' && (
          <label className="flex items-center gap-3 text-sm text-zinc-400">
            <span className="w-32">Finger (fine)</span>
            <input
              type="range"
              min={1}
              max={12}
              step={0.5}
              value={props.fineSensitivity}
              onChange={(e) => props.onFineSensitivityChange(parseFloat(e.target.value))}
            />
            <span className="w-10 tabular-nums">{props.fineSensitivity.toFixed(1)}</span>
          </label>
        )}

        <label className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="w-32">Gesture hold</span>
          <input
            type="range"
            min={2}
            max={5}
            step={1}
            value={props.dwellFrames}
            onChange={(e) => props.onDwellFramesChange(parseInt(e.target.value))}
          />
          <span className="w-16 tabular-nums">{props.dwellFrames} frames</span>
        </label>

        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={props.invertX}
              onChange={(e) => props.onInvertXChange(e.target.checked)}
            />
            Invert X
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={props.invertY}
              onChange={(e) => props.onInvertYChange(e.target.checked)}
            />
            Invert Y
          </label>
          <button
            onClick={props.onRecenter}
            disabled={props.recenterDisabled}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {props.centeredFlash ? '✓ Centered' : 'Recenter'}
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={props.accelerationEnabled}
            onChange={(e) => props.onAccelerationChange(e.target.checked)}
          />
          <span>
            Enable Acceleration{' '}
            <span className="text-xs text-zinc-600">
              (fast head movement travels further, like mouse acceleration)
            </span>
          </span>
        </label>

        <hr className="border-zinc-800" />

        {/* Teach a gesture */}
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-zinc-600">Teach a gesture</span>
          {props.gesturesEnabled && !props.teaching && (
            <p className="text-xs text-amber-400">
              Turn off &ldquo;Enable Gestures&rdquo; on the main screen to teach a new one.
            </p>
          )}
          {!props.gesturesEnabled && !props.teaching && (
            <button
              onClick={props.onStartTeach}
              disabled={props.teachBusy}
              className="self-start rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {props.teachBusy ? 'Looking…' : 'Teach a gesture (pose, then click)'}
            </button>
          )}

          {props.teaching && (
            <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 p-4">
              <span className="text-xs text-zinc-500">The model saw:</span>
              <textarea
                className="resize-none rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none"
                rows={2}
                value={props.teachDescription}
                onChange={(e) => props.onTeachDescriptionChange(e.target.value)}
              />
              <input
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none"
                placeholder="Gesture name (e.g. Peace Sign)"
                value={props.teachName}
                onChange={(e) => props.onTeachNameChange(e.target.value)}
              />
              <select
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none"
                value={props.teachAction}
                onChange={(e) => props.onTeachActionChange(e.target.value)}
              >
                {props.actions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={props.onSaveTeach}
                  disabled={!props.teachName.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={props.onCancelTeach}
                  className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Gesture library */}
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-zinc-600">Gestures</span>
          {props.gestures.length === 0 && <span className="text-sm text-zinc-600">None yet.</span>}
          {props.gestures.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-3 rounded-lg bg-zinc-950 px-3 py-2 text-sm"
            >
              <span className="w-28 truncate font-semibold">{g.name}</span>
              <span className="flex-1 truncate text-zinc-500" title={g.description}>
                {g.description}
              </span>
              <span className="whitespace-nowrap text-indigo-400">{actionLabel(g.action)}</span>
              <button
                onClick={() => props.onDeleteGesture(g.id)}
                className="text-zinc-500 hover:text-red-400"
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
