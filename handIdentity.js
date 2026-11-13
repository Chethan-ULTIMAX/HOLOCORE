/**
 * HOLOCORE — handIdentity.js
 * -----------------------------------------------------------------------------
 * Stable identities for hands across camera frames.
 *
 * THE PROBLEM
 *
 * MediaPipe returns hands in no guaranteed order. Its `handedness` label is a
 * useful hint but not an identity: it can read "Unknown", it can be wrong when
 * the hand is rotated, and two hands can briefly report the same label. Three
 * parts of HOLOCORE were keying hands differently:
 *
 *   - analysers, by the handedness string, so both hands shared one filter
 *     history whenever the labels collided or read "Unknown";
 *   - skeleton rigs, by `${side}-${arrayIndex}`, so simply reordering the array
 *     moved a rig's filter history onto the other physical hand;
 *   - the depth registry, by `hand.key`, which did not exist, so every hand
 *     shared one calibration under the key "hand-0".
 *
 * Anything keyed that way loses its history when the tracker reorders its
 * results, which shows up as a hand that jumps, a pinch that resets, or a
 * two-hand rotation that flips 180 degrees mid-gesture.
 *
 * THE APPROACH
 *
 * Match each incoming hand to an existing track by predicted position, with
 * handedness as a tie-breaker rather than the identity itself. MediaPipe's
 * normalised coordinates are in the same space every frame, so the palm centre
 * is a good landmark: hands move continuously, and two hands cannot occupy the
 * same place. Gating the match by distance means a hand that leaves and a
 * different hand that enters nearby are still treated as separate.
 *
 * Predicted position uses the track's velocity, so a fast-moving hand is matched
 * against where it is going rather than where it was.
 *
 * Keys are opaque strings ("hand-1", "hand-2", ...) and are never reused within a
 * session until the track has been forgotten, so a key always means one physical
 * hand.
 */

/** Maximum distance, in normalised image units, for a match to be considered. */
export const MATCH_GATE = 0.28;

/** Frames a track survives without a match before it is forgotten. */
export const TRACK_TTL_FRAMES = 12;

/** Weight applied to handedness agreement when scoring a match. */
const HANDEDNESS_BONUS = 0.35;

/**
 * Assign stable keys to the hands in one frame.
 */
export class HandIdentityTracker {
  constructor({ gate = MATCH_GATE, ttl = TRACK_TTL_FRAMES } = {}) {
    this.gate = gate;
    this.ttl = ttl;
    /** @type {Map<string, object>} key -> track */
    this.tracks = new Map();
    this.nextId = 1;
    /** Incremented once per frame that contains hands. */
    this.frame = 0;
  }

  /**
   * Match this frame's hands to tracks.
   *
   * @param {Array<Array<{x:number,y:number}>>} hands normalised landmarks
   * @param {string[]} handedness MediaPipe labels, same order as `hands`
   * @returns {{keys: string[], entries: object[]}} stable key per hand, in the
   *          incoming order
   */
  assign(hands, handedness = []) {
    const list = Array.isArray(hands) ? hands : [];
    this.frame += 1;

    // Palm centre is a stable, cheap landmark. MediaPipe index 9 is the middle
    // knuckle, which is present in every valid 21-point hand.
    const observations = list.map((landmarks, index) => {
      const point = landmarks?.[9] || landmarks?.[0] || null;
      return {
        index,
        side: String(handedness?.[index] || "Unknown"),
        point: point ? { x: point.x, y: point.y } : null
      };
    });

    // Greedy global matching over every (track, observation) pair, cheapest
    // first. With at most two hands this is exact and needs no Hungarian solver.
    const pairs = [];
    for (const [key, track] of this.tracks) {
      if (!track.point) continue;
      for (const observation of observations) {
        if (!observation.point) continue;
        const predicted = this._predict(track);
        const distance = Math.hypot(
          observation.point.x - predicted.x,
          observation.point.y - predicted.y
        );
        if (distance > this.gate) continue;
        // Handedness breaks ties but never vetoes a close positional match: the
        // label is the less reliable signal, and a rotated hand can misreport it.
        const agrees = track.side === observation.side && observation.side !== "Unknown";
        pairs.push({
          key,
          observation,
          cost: distance - (agrees ? HANDEDNESS_BONUS * this.gate : 0),
          distance
        });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);

    const matchedKeys = new Map();   // observation index -> key
    const usedTracks = new Set();
    for (const pair of pairs) {
      if (usedTracks.has(pair.key)) continue;
      if (matchedKeys.has(pair.observation.index)) continue;
      usedTracks.add(pair.key);
      matchedKeys.set(pair.observation.index, pair.key);
    }

    // Anything unmatched is a new hand.
    const keys = observations.map(observation => {
      const existing = matchedKeys.get(observation.index);
      if (existing) return existing;
      const key = `hand-${this.nextId++}`;
      return key;
    });

    // Update tracks with this frame's positions.
    const entries = observations.map((observation, index) => {
      const key = keys[index];
      let track = this.tracks.get(key);
      if (!track) {
        track = {
          key, side: observation.side, point: observation.point,
          velocity: { x: 0, y: 0 }, missed: 0, age: 0
        };
        this.tracks.set(key, track);
      } else {
        if (observation.point && track.point) {
          // Exponential velocity estimate. Smoothed so a single noisy frame does
          // not throw the prediction off.
          track.velocity.x = track.velocity.x * 0.6 + (observation.point.x - track.point.x) * 0.4;
          track.velocity.y = track.velocity.y * 0.6 + (observation.point.y - track.point.y) * 0.4;
        }
        track.point = observation.point || track.point;
        // Keep a label once known; do not flip to "Unknown" on a bad frame.
        if (observation.side !== "Unknown") track.side = observation.side;
        track.missed = 0;
        track.age += 1;
      }
      return track;
    });

    // Age out tracks that have not been seen for a while. Doing this on absence
    // rather than instantly is what lets a hand survive a single dropped frame
    // without losing its identity and filter history.
    for (const [key, track] of [...this.tracks]) {
      if (keys.includes(key)) continue;
      track.missed += 1;
      if (track.missed > this.ttl) this.tracks.delete(key);
    }

    return { keys, entries };
  }

  _predict(track) {
    return {
      x: track.point.x + track.velocity.x,
      y: track.point.y + track.velocity.y
    };
  }

  /** The stable key for a set of landmarks, or null. */
  keyFor(landmarks) {
    const point = landmarks?.[9] || landmarks?.[0];
    if (!point) return null;
    let best = null;
    let bestDistance = this.gate;
    for (const [key, track] of this.tracks) {
      if (!track.point) continue;
      const distance = Math.hypot(point.x - track.point.x, point.y - track.point.y);
      if (distance < bestDistance) { bestDistance = distance; best = key; }
    }
    return best;
  }

  /** Forget everything. Called on tracking loss and on a device switch. */
  reset() {
    this.tracks.clear();
    this.nextId = 1;
    this.frame = 0;
  }

  get size() {
    return this.tracks.size;
  }
}
