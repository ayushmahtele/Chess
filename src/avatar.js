// Profile pictures: your own uploaded photo, otherwise your Google photo, otherwise your initial.
import { h } from './dom.js';

/** profile.photo: a small image (data URL), 'none' (show the initial), or unset (use the Google photo). */
export function avatarSrc(profile, user) {
  if (profile?.photo === 'none') return null;
  return profile?.photo || user?.photo || null;
}
export function avatar(profile, user, cls = '') {
  const src = avatarSrc(profile, user);
  return src
    ? h('img.avatar', { class: cls, src, alt: '', referrerpolicy: 'no-referrer' })
    : h('span.avatar', { class: cls }, ((profile?.name || '?')[0] || '?').toUpperCase());
}
