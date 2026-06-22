/**
 * icons — central icon resolver for tramo's canvas + palette.
 *
 * Two sources:
 *   - Lucide icons for generic primitives (triggers, transforms, logic, etc.)
 *     selected by `NodeDefinition.icon` (a Lucide component name).
 *   - simple-icons brand SVGs for integration nodes selected by
 *     `NodeDefinition.iconBrand` (a simple-icons slug). When `iconBrand`
 *     is set, it takes precedence over `icon`.
 *
 * Both maps are intentionally explicit, not dynamic — tree-shaking
 * keeps only the icons we actually use in the bundle, and adding a new
 * node type forces a one-line registration here.
 */

import { memo } from 'react';
import {
  Cable,
  Clock,
  CloudDownload,
  Code,
  Database,
  GitBranch,
  Globe,
  Hourglass,
  Info,
  ListPlus,
  LogIn,
  LogOut,
  Merge,
  PhoneOutgoing,
  Play,
  PlayCircle,
  Plus,
  Repeat,
  Reply,
  Sparkles,
  Split,
  StickyNote,
  Type,
  Variable,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { IntegrationDefinition, NodeCategory, NodeDefinition } from '@tramo/spec';
// simple-icons ships its types as a single minified .d.ts line; TS can't
// always resolve individual named exports through it, so we read the full
// namespace and index into it. The runtime export is unaffected.
import * as simpleIcons from 'simple-icons';

interface SimpleIcon {
  title: string;
  slug: string;
  hex: string;
  path: string;
}

const si = simpleIcons as unknown as Record<string, SimpleIcon>;

/* ---------- Lucide registry — generic icons ---------- */

const LUCIDE: Record<string, LucideIcon> = {
  Play,
  Clock,
  CloudDownload,
  Code,
  Globe,
  GitBranch,
  Merge,
  Sparkles,
  StickyNote,
  Type,
  Cable,
  Zap,
  PlayCircle,
  Wand2,
  Info,
  Variable,
  Plus,
  ListPlus,
  Database,
  Repeat,
  Hourglass,
  Reply,
  Split,
  LogIn,
  LogOut,
  PhoneOutgoing,
};

/* ---------- category metadata — pill label, icon, soft colors ---------- */

export interface CategoryMeta {
  label: string;
  Icon: LucideIcon;
  /** Soft background tint for the pill. */
  bg: string;
  /** Saturated text + icon color, used on the pill. */
  fg: string;
}

export const CATEGORY_META: Record<NodeCategory, CategoryMeta> = {
  trigger:   { label: 'Trigger',   Icon: Zap,         bg: '#ede9fe', fg: '#6d28d9' },
  action:    { label: 'Action',    Icon: PlayCircle,  bg: '#d1fae5', fg: '#047857' },
  transform: { label: 'Transform', Icon: Wand2,       bg: '#dbeafe', fg: '#1d4ed8' },
  logic:     { label: 'Condition', Icon: GitBranch,   bg: '#e0f2fe', fg: '#0369a1' },
  state:     { label: 'Variable',  Icon: Variable,    bg: '#ccfbf1', fg: '#0f766e' },
  ai:        { label: 'AI',        Icon: Sparkles,    bg: '#fce7f3', fg: '#be185d' },
  io:        { label: 'I/O',       Icon: Cable,       bg: '#f1f5f9', fg: '#475569' },
};

/* ---------- simple-icons registry — brand icons ---------- */

const BRAND: Record<string, SimpleIcon> = {
  // Note: `slack` was removed from simple-icons after a brand-takedown
  // request in 2024 — don't add it back without a replacement source.
  telegram: si.siTelegram!,
  github: si.siGithub!,
  discord: si.siDiscord!,
  notion: si.siNotion!,
  linear: si.siLinear!,
  gmail: si.siGmail!,
  openai: si.siOpenai!,
  anthropic: si.siAnthropic!,
  airtable: si.siAirtable!,
  stripe: si.siStripe!,
};

export interface NodeIconProps {
  definition: NodeDefinition | undefined;
  /** Pixel size of the rendered icon. Default 20. */
  size?: number;
  /** When true, ignore brand colors and use currentColor instead. */
  monochrome?: boolean;
}

/**
 * Render an icon for a node, picking between brand SVG and Lucide
 * component based on the definition. Falls back to a diamond glyph
 * when nothing matches — visible, but a signal that the registration
 * is missing.
 */
export const NodeIcon = memo(function NodeIconImpl({
  definition,
  size = 20,
  monochrome = false,
}: NodeIconProps) {
  if (definition?.iconBrand) {
    const brand = BRAND[definition.iconBrand];
    if (brand) {
      return (
        <svg
          role="img"
          aria-label={brand.title}
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill={monochrome ? 'currentColor' : `#${brand.hex}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>{brand.title}</title>
          <path d={brand.path} />
        </svg>
      );
    }
  }
  if (definition?.icon) {
    const Lucide = LUCIDE[definition.icon];
    if (Lucide) {
      return <Lucide size={size} strokeWidth={2} aria-hidden />;
    }
  }
  return <span aria-hidden>◆</span>;
});

/**
 * Render an icon for an IntegrationDefinition tile (picker grid). Falls
 * back to NodeIcon's resolution rules by adapting the shape.
 */
export const IntegrationIcon = memo(function IntegrationIconImpl({
  integration,
  size = 20,
  monochrome = false,
}: {
  integration: IntegrationDefinition;
  size?: number;
  monochrome?: boolean;
}) {
  // Reuse NodeIcon by projecting just the fields it reads.
  const proxy = {
    icon: integration.icon ?? '',
    iconBrand: integration.iconBrand,
  } as unknown as NodeDefinition;
  return <NodeIcon definition={proxy} size={size} monochrome={monochrome} />;
});
