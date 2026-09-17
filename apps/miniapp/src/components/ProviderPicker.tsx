import { PROVIDER_PRESETS, type ProviderId } from '@foodlog/core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** Provider selection incl. the custom escape hatch. */
export type ProviderChoiceId = ProviderId | 'custom';

/** The full provider configuration this picker edits. */
export interface ProviderConfig {
  provider: ProviderChoiceId;
  model: string;
  baseUrl: string;
  supportsDetail: boolean;
}

interface ProviderPickerProps {
  /** Unique id prefix so multiple pickers on one page don't collide. */
  idPrefix: string;
  value: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
}

const PROVIDERS = Object.values(PROVIDER_PRESETS);
/** Sentinel option value that reveals the free-text model input. */
const CUSTOM_MODEL = '__custom__';

/**
 * Provider + model picker used by both the primary and fallback settings cards.
 * Model is a dropdown of the provider's known-good models (guards typos), with
 * a "Custom…" option that reveals a text field for brand-new/retired names.
 * Selecting the "Custom" provider reveals base URL + detail fields for any
 * OpenAI-compatible endpoint.
 */
export function ProviderPicker({ idPrefix, value, onChange }: ProviderPickerProps) {
  const isCustom = value.provider === 'custom';
  const presetModels: string[] =
    value.provider === 'custom' ? [] : PROVIDER_PRESETS[value.provider].models;
  // Model is "known" if it matches a preset model; otherwise show the free input.
  const modelIsPreset = !isCustom && presetModels.includes(value.model);
  const modelSelectValue = modelIsPreset ? value.model : CUSTOM_MODEL;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-provider`}>Provider</Label>
        <select
          id={`${idPrefix}-provider`}
          value={value.provider}
          onChange={(e) => {
            const provider = e.target.value as ProviderChoiceId;
            // Reset model to the new provider's default (or blank for custom).
            const model = provider === 'custom' ? '' : PROVIDER_PRESETS[provider].defaultModel;
            onChange({ ...value, provider, model });
          }}
          className="border-input focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom (advanced)</option>
        </select>
      </div>

      {isCustom ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-baseurl`}>Base URL</Label>
            <Input
              id={`${idPrefix}-baseurl`}
              placeholder="https://your-endpoint.example.com/v1"
              value={value.baseUrl}
              onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              Any OpenAI-compatible Chat Completions endpoint (https). The path
              <code> /chat/completions</code> is appended automatically.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-model`}>Model</Label>
            <Input
              id={`${idPrefix}-model`}
              placeholder="model id"
              value={value.model}
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`${idPrefix}-detail`}>Send image detail=high</Label>
            <Switch
              id={`${idPrefix}-detail`}
              checked={value.supportsDetail}
              onCheckedChange={(v) => onChange({ ...value, supportsDetail: v })}
            />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-model`}>Model</Label>
          <select
            id={`${idPrefix}-model`}
            value={modelSelectValue}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...value,
                model: v === CUSTOM_MODEL ? '' : v,
              });
            }}
            className="border-input focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
          >
            {presetModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={CUSTOM_MODEL}>Custom…</option>
          </select>
          {!modelIsPreset && (
            <Input
              aria-label="Custom model id"
              placeholder="type a model id"
              value={value.model}
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            />
          )}
        </div>
      )}
    </>
  );
}
