import type { HagemiFacts, HagemiSettings } from '../types';

export interface HagemiPetInstance {
  receive(message: {
    t: 'hello' | 'settings' | 'art' | 'facts' | 'react' | 'say' | 'models' | 'heartbeat' | 'bye';
    [key: string]: any;
  }): void;
  dispose(): void;
  animator?: any;
  readonly position: { x: number; y: number };
}

export interface BootHagemiOptions {
  initialSettings?: Partial<HagemiSettings>;
  onPositionChange?: (position: { x: number; y: number; dock?: 'left' | 'right' }) => void;
  onSettingsChange?: (patch: any) => void;
  onStateChange?: (state: string) => void;
  onError?: (error: any) => void;
}

export function bootHagemi(options?: BootHagemiOptions): Promise<HagemiPetInstance | null>;
