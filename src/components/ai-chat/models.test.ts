import { describe, expect, it } from 'bun:test';
import { modelLogo, modelLabel } from './models';

describe('model logo', () => {
  it('is read from the OpenRouter provider prefix', () => {
    expect(modelLogo('deepseek/deepseek-v4-flash')).toEqual({
      src: '/modeles/deepseek.svg',
      mono: false,
    });
    expect(modelLogo('anthropic/claude-sonnet-5')).toEqual({
      src: '/modeles/claude.svg',
      mono: false,
    });
    expect(modelLogo('openai/gpt-5.5')).toEqual({ src: '/modeles/openai.svg', mono: true });
    expect(modelLogo('z-ai/glm-5')).toEqual({ src: '/modeles/zhipu.svg', mono: false });
  });

  it('falls back on the model name when the prefix is unknown or missing', () => {
    expect(modelLogo('gemini-3.7-flash')?.src).toBe('/modeles/gemini.svg');
    expect(modelLogo('inconnu/llama-5-70b')?.src).toBe('/modeles/meta.svg');
    expect(modelLogo('MoonshotAI/Kimi-K3')?.src).toBe('/modeles/kimi.svg');
  });

  it('does not know everything: null, and the screen shows the neutral icon', () => {
    expect(modelLogo('fournisseur-obscur/modele-maison')).toBeNull();
  });
});

describe('model label', () => {
  it('prettifies the identifier when there is no commercial name', () => {
    expect(modelLabel('deepseek/deepseek-v4-flash')).toBe('DeepSeek V4 Flash');
    expect(modelLabel('x/y', { 'x/y': 'Nom officiel' })).toBe('Nom officiel');
  });
});
