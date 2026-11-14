import { describe, expect, it } from 'vitest';
import { LIVE_TRACKING_PROMPT, isLiveTrackingRequest } from '../src/agent/prompts/live.js';
import { SYSTEM_PROMPT, buildSystemPrompt } from '../src/agent/prompts/system.js';

describe('isLiveTrackingRequest', () => {
  it.each([
    'Give me live updates on the Ukraine war',
    'track Tesla stock price',
    'monitor the iPhone 18 release date',
    'alert me when Taylor Swift announces new tour dates',
    'keep me posted on the Turkey earthquake relief',
    'follow the latest news on the EU AI Act',
    'keep an eye on Elon Musk statements',
  ])('live: %s', (text) => expect(isLiveTrackingRequest(text)).toBe(true));

  it.each([
    'Tell me about Narendra Modi',
    'Did Keir Starmer keep his tax promises?',
    'Track Modi promises on healthcare',
    'What did the CEO of Apple promise on climate?',
  ])('report: %s', (text) => expect(isLiveTrackingRequest(text)).toBe(false));
});

describe('buildSystemPrompt', () => {
  it('uses the report prompt by default and the live prompt once a message asks for live updates', () => {
    expect(buildSystemPrompt(null)).toBe(SYSTEM_PROMPT);
    expect(buildSystemPrompt(null, ['Tell me about Modi'])).toBe(SYSTEM_PROMPT);
    expect(buildSystemPrompt(null, ['live updates on the Gaza ceasefire', 'and casualties?'])).toBe(LIVE_TRACKING_PROMPT);
  });
  it('scopes to the viewed entity', () => {
    expect(buildSystemPrompt('ent-1', ['monitor bitcoin price'])).toContain('entity_id "ent-1"');
  });
  it('live plan uses the app monitor kinds', () => {
    expect(LIVE_TRACKING_PROMPT).toContain('```monitor-plan');
    for (const k of ['news_feed', 'page', 'sitemap', 'intervalMinutes']) expect(LIVE_TRACKING_PROMPT).toContain(k);
    // Freshness-first source choice, and the tracked URLs are always shown.
    for (const k of ['FIND THE FRESHEST', 'updates per hour', 'Monitoring: <page title>', 'Tracking now:']) expect(LIVE_TRACKING_PROMPT).toContain(k);
  });
});
