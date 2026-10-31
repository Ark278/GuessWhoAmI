const AVATAR_COLORS = [
  "from-violet-600 to-indigo-700",
  "from-fuchsia-600 to-pink-700",
  "from-cyan-500 to-blue-600",
  "from-emerald-500 to-teal-700",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-red-700",
  "from-purple-600 to-purple-900",
  "from-teal-500 to-emerald-700",
];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
