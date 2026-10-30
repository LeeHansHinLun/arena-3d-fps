import type { World } from './world';

export interface NavNode {
  x: number;
  y: number;
  z: number;
  edges: number[];
  jump: boolean[];
  comp: number;
}

/** Multi-layer 2.5D grid navigation: nodes sit on any walkable surface with head clearance. */
export class Nav {
  nodes: NavNode[] = [];
  cell = 2;
  cols: number;
  rows: number;
  ox: number;
  oz: number;
  cellNodes: number[][] = [];
  main: number[] = [];
  private g: Float32Array;
  private par: Int32Array;
  private seen: Int32Array;
  private closed: Int32Array;
  private stampN = 0;
  private pathCache = new Map<number, number[] | null>();

  constructor(world: World, w: number, d: number) {
    this.cols = Math.floor(w / this.cell);
    this.rows = Math.floor(d / this.cell);
    this.ox = -w / 2;
    this.oz = -d / 2;
    const tops: number[] = [];
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const x = this.ox + (i + 0.5) * this.cell;
        const z = this.oz + (j + 0.5) * this.cell;
        const list: number[] = [];
        world.topsIn(x - 0.9, z - 0.9, x + 0.9, z + 0.9, tops);
        const cands = [0, ...tops].sort((a, b) => a - b);
        let last = -99;
        for (const h of cands) {
          if (h - last < 0.05) continue;
          last = h;
          if (h > 24) continue;
          if (!world.supported(x, z, h)) continue;
          if (world.anyOverlap(x - 0.4, h + 0.06, z - 0.4, x + 0.4, h + 1.8, z + 0.4)) continue;
          list.push(this.nodes.length);
          this.nodes.push({ x, y: h, z, edges: [], jump: [], comp: -1 });
        }
        this.cellNodes[j * this.cols + i] = list;
      }
    }
    // edges
    const parent = new Int32Array(this.nodes.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (a: number): number => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        for (const id of this.cellNodes[j * this.cols + i]) {
          const n = this.nodes[id];
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const ci = i + di, cj = j + dj;
              if (ci < 0 || cj < 0 || ci >= this.cols || cj >= this.rows) continue;
              const diag = di !== 0 && dj !== 0;
              for (const mid of this.cellNodes[cj * this.cols + ci]) {
                const m = this.nodes[mid];
                const dh = m.y - n.y;
                if (dh > 1.45 || dh < -3.4) continue;
                const yr = Math.max(n.y, m.y);
                const mx = (n.x + m.x) / 2, mz = (n.z + m.z) / 2;
                const rr = diag ? 0.55 : 0.42;
                if (world.anyOverlap(mx - rr, yr + 0.06, mz - rr, mx + rr, yr + 1.8, mz + rr)) continue;
                if (diag) {
                  // both orthogonal neighbours must be passable at similar height
                  const a = this.cellNodes[j * this.cols + ci].some((q) => Math.abs(this.nodes[q].y - n.y) < 0.6);
                  const b = this.cellNodes[cj * this.cols + i].some((q) => Math.abs(this.nodes[q].y - n.y) < 0.6);
                  if (!a || !b) continue;
                }
                n.edges.push(mid);
                n.jump.push(dh > 0.58);
                if (dh >= -1.45) {
                  const ra = find(id), rb = find(mid);
                  if (ra !== rb) parent[ra] = rb;
                }
              }
            }
          }
        }
      }
    }
    // components
    const sizes = new Map<number, number>();
    this.nodes.forEach((n, id) => {
      n.comp = find(id);
      sizes.set(n.comp, (sizes.get(n.comp) ?? 0) + 1);
    });
    let bestC = -1, bestS = 0;
    sizes.forEach((s, c) => {
      if (s > bestS) { bestS = s; bestC = c; }
    });
    this.nodes.forEach((n, id) => {
      if (n.comp === bestC) this.main.push(id);
    });
    this.g = new Float32Array(this.nodes.length);
    this.par = new Int32Array(this.nodes.length);
    this.seen = new Int32Array(this.nodes.length);
    this.closed = new Int32Array(this.nodes.length);
  }

  nearest(x: number, y: number, z: number): number {
    const ci = Math.floor((x - this.ox) / this.cell);
    const cj = Math.floor((z - this.oz) / this.cell);
    let best = -1;
    let bs = 1e9;
    for (let r = 0; r <= 4; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
          for (const id of this.cellNodes[j * this.cols + i]) {
            const n = this.nodes[id];
            const dy = n.y - y;
            if (dy > 1.3) continue;
            const s = Math.hypot(n.x - x, n.z - z) + Math.abs(dy) * 2.5;
            if (s < bs) { bs = s; best = id; }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  /** A* path as node ids (start..goal) or null, cached per node pair */
  path(from: number, to: number): number[] | null {
    if (from < 0 || to < 0) return null;
    const ck = from * 100000 + to;
    const cached = this.pathCache.get(ck);
    if (cached !== undefined) return cached;
    const res = this.pathUncached(from, to);
    if (this.pathCache.size > 400) this.pathCache.clear();
    this.pathCache.set(ck, res);
    return res;
  }

  private pathUncached(from: number, to: number): number[] | null {
    if (from === to) return [to];
    if (from === to) return [to];
    const stamp = ++this.stampN;
    const hf: number[] = [];
    const hi: number[] = [];
    const push = (f: number, id: number) => {
      let k = hf.length;
      hf.push(f);
      hi.push(id);
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hf[p] <= hf[k]) break;
        [hf[p], hf[k]] = [hf[k], hf[p]];
        [hi[p], hi[k]] = [hi[k], hi[p]];
        k = p;
      }
    };
    const pop = () => {
      const id = hi[0];
      const lf = hf.pop()!;
      const li = hi.pop()!;
      if (hf.length) {
        hf[0] = lf;
        hi[0] = li;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < hf.length && hf[l] < hf[m]) m = l;
          if (r < hf.length && hf[r] < hf[m]) m = r;
          if (m === k) break;
          [hf[m], hf[k]] = [hf[k], hf[m]];
          [hi[m], hi[k]] = [hi[k], hi[m]];
          k = m;
        }
      }
      return id;
    };
    const goal = this.nodes[to];
    this.g[from] = 0;
    this.seen[from] = stamp;
    this.par[from] = -1;
    push(0, from);
    let iter = 0;
    while (hf.length && iter++ < 7000) {
      const cur = pop();
      if (cur === to) {
        const out: number[] = [];
        for (let c = to; c !== -1; c = this.par[c]) out.push(c);
        return out.reverse();
      }
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;
      const n = this.nodes[cur];
      for (let e = 0; e < n.edges.length; e++) {
        const nb = n.edges[e];
        const m = this.nodes[nb];
        const cost = Math.hypot(m.x - n.x, m.z - n.z) + (n.jump[e] ? 3 : 0) + Math.abs(m.y - n.y) * 0.3;
        const ng = this.g[cur] + cost;
        if (this.seen[nb] !== stamp || ng < this.g[nb]) {
          this.seen[nb] = stamp;
          this.g[nb] = ng;
          this.par[nb] = cur;
          push(ng + Math.hypot(goal.x - m.x, goal.z - m.z), nb);
        }
      }
    }
    return null;
  }

  randomMain(r: () => number): number {
    return this.main[Math.floor(r() * this.main.length)];
  }

  /** farthest-point sampling over the main component */
  spread(count: number, r: () => number, minY = 0, maxY = 99, margin = 0): number[] {
    const lx = -this.ox - margin;
    const lz = -this.oz - margin;
    let pool = this.main.filter((id) => {
      const n = this.nodes[id];
      return n.y >= minY && n.y <= maxY && Math.abs(n.x) < lx && Math.abs(n.z) < lz;
    });
    if (pool.length < count * 3) pool = this.main.filter((id) => this.nodes[id].y >= minY && this.nodes[id].y <= maxY);
    if (!pool.length) return [];
    const picked: number[] = [pool[Math.floor(r() * pool.length)]];
    const dist = new Float32Array(pool.length).fill(1e9);
    while (picked.length < count && picked.length < pool.length) {
      const last = this.nodes[picked[picked.length - 1]];
      let bi = 0, bd = -1;
      for (let i = 0; i < pool.length; i++) {
        const n = this.nodes[pool[i]];
        const d = Math.hypot(n.x - last.x, n.z - last.z) + Math.abs(n.y - last.y);
        if (d < dist[i]) dist[i] = d;
        if (dist[i] > bd) { bd = dist[i]; bi = i; }
      }
      picked.push(pool[bi]);
    }
    return picked;
  }
}
