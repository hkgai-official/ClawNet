import {
  User, Settings, ShieldCheck, Tag, Search, MessageSquare, Users, Sparkles,
  FileText, Image, Video, Mic, ArrowUpCircle, X, Check, Plus, Minus, LogOut,
  type LucideIcon,
} from 'lucide-react';
import { type ReactElement } from 'react';

const ICON_MAP = {
  'person.circle': User,
  'gear': Settings,
  'lock.shield': ShieldCheck,
  'tag': Tag,
  'magnifyingglass': Search,
  'bubble.left.and.bubble.right': MessageSquare,
  'person.2': Users,
  'sparkles': Sparkles,
  'doc': FileText,
  'photo': Image,
  'video': Video,
  'mic': Mic,
  'arrow.up.circle.fill': ArrowUpCircle,
  'rectangle.portrait.and.arrow.right': LogOut,
  'xmark': X,
  'checkmark': Check,
  'plus': Plus,
  'minus': Minus,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICON_MAP;

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean;
}

export function Icon({ name, size = 20, className, ...rest }: IconProps): ReactElement {
  const C = ICON_MAP[name];
  return <C size={size} className={className} {...rest} />;
}
