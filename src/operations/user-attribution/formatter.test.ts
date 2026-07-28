import { describe, it, expect } from 'bun:test';
import { formatUserTurn, sanitizeUsername, shouldAttribute } from './formatter.js';

describe('formatUserTurn', () => {
  it('prefixes a normal message with the sanitized login when enabled', () => {
    expect(formatUserTurn('deploy the app', 'alice.smith', true)).toBe('[@alice.smith]: deploy the app');
  });

  it('returns the message unchanged when attribution is disabled', () => {
    expect(formatUserTurn('deploy the app', 'alice.smith', false)).toBe('deploy the app');
  });

  it('returns the message unchanged when username is undefined', () => {
    expect(formatUserTurn('run tests', undefined, true)).toBe('run tests');
  });

  it('returns the message unchanged when username is empty', () => {
    expect(formatUserTurn('run tests', '', true)).toBe('run tests');
  });

  it('returns the message unchanged for the "unknown" sentinel (case-insensitive)', () => {
    expect(formatUserTurn('run tests', 'unknown', true)).toBe('run tests');
    expect(formatUserTurn('run tests', 'Unknown', true)).toBe('run tests');
  });

  it('returns the message unchanged when the username sanitizes to empty', () => {
    expect(formatUserTurn('run tests', '@@@', true)).toBe('run tests');
  });

  it('strips unsafe characters from the username but not the message body', () => {
    expect(formatUserTurn('use <angle> & [brackets]', 'a l/i>ce', true)).toBe('[@alice]: use <angle> & [brackets]');
  });

  it('keeps a multi-line body intact after the inline prefix', () => {
    expect(formatUserTurn('line one\nline two', 'bob', true)).toBe('[@bob]: line one\nline two');
  });
});

describe('sanitizeUsername', () => {
  it('keeps login-shaped characters', () => {
    expect(sanitizeUsername('user.name_1-2')).toBe('user.name_1-2');
  });

  it('drops spaces and punctuation', () => {
    expect(sanitizeUsername('a b@c!')).toBe('abc');
  });
});

describe('shouldAttribute', () => {
  it('attributes in a solo session — this fork drops the multi-participant gate', () => {
    // Upstream gates on `participantCount > 1`, reading the size of
    // `sessionAllowedUsers`. That set only grows via `!invite` or a paused
    // session revived by someone else, while anyone the platform's global
    // allowlist accepts can write into a thread without ever entering it. On
    // this deployment the whole team is globally allowed and shares threads
    // without `!invite`, so the count stays 1 and the guard would silence
    // attribution permanently. See FORK_NOTES.md.
    expect(shouldAttribute(true, 1)).toBe(true);
  });

  it('attributes when a session has more than one participant', () => {
    expect(shouldAttribute(true, 2)).toBe(true);
    expect(shouldAttribute(true, 5)).toBe(true);
  });

  it('never attributes when the flag is off, however many participants', () => {
    expect(shouldAttribute(false, 1)).toBe(false);
    expect(shouldAttribute(false, 2)).toBe(false);
    expect(shouldAttribute(false, 99)).toBe(false);
  });

  it('ignores the participant count entirely', () => {
    // The count is still accepted so every call site stays byte-identical to
    // upstream, which keeps rebases cheap; it must not influence the decision.
    expect(shouldAttribute(true, 0)).toBe(true);
  });
});
