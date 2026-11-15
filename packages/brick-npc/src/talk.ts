/**
 * The line between the people walking about the scene and the game's talk: the scene says who is
 * near enough to talk to and where the speaker's head is on screen, and the game says who is
 * speaking. Shared by reference, so the scene writes it every frame without React.
 */
export class TalkLink {
  /** The person within reach to talk to, nearest first, or null. */
  nearby: string | null = null;
  /** Who is speaking now, or null. */
  speaker: string | null = null;
  /** Where the speaker's head is on screen, in CSS pixels, while it shows. */
  readonly anchor = { x: 0, y: 0, visible: false };
  private readonly listeners = new Set<() => void>();

  /** Starts `id` speaking, or ends whoever is when null. */
  say(id: string | null) {
    if (this.speaker === id) return;
    this.speaker = id;
    if (!id) this.anchor.visible = false;
    this.changed();
  }

  /** Says the nearby person changed; quiet when it did not. */
  setNearby(id: string | null) {
    if (this.nearby === id) return;
    this.nearby = id;
    this.changed();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed() {
    for (const listener of this.listeners) listener();
  }
}

/** How close the player comes to talk to someone, in studs. */
export const TALK_RANGE = 4.5;
/** How far the player walks off before a conversation ends, in studs. */
export const TALK_LEAVE = 10;
