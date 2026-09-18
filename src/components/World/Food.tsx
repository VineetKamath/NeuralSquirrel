"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Experiment } from "@/simulation/Experiment";
import { hashString, mulberry32 } from "@/utils/rng";

const MAX = 600;

/** Food items rendered from live world state (updates when food changes). */
export function Food({ experiment }: { experiment: Experiment }) {
  const version = useRef(-1);
  const { acorns, caps, berries, mounds } = useMemo(() => {
    const nutGeo = new THREE.SphereGeometry(0.014, 10, 8);
    nutGeo.scale(1, 1.35, 1);
    nutGeo.translate(0, 0.016, 0);
    const capGeo = new THREE.SphereGeometry(0.0155, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.scale(1, 0.7, 1);
    capGeo.translate(0, 0.028, 0);
    const berryGeo = new THREE.SphereGeometry(0.018, 8, 6);
    const moundGeo = new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    moundGeo.scale(1, 0.35, 1);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX);
      m.count = 0;
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.frustumCulled = false;
      return m;
    };
    return {
      acorns: mk(nutGeo, new THREE.MeshStandardMaterial({ color: "#8a5a2b", roughness: 0.45 }), true),
      caps: mk(capGeo, new THREE.MeshStandardMaterial({ color: "#5a4630", roughness: 0.9 }), false),
      berries: mk(berryGeo, new THREE.MeshStandardMaterial({ color: "#7d0f1e", roughness: 0.3, emissive: "#200004" }), false),
      mounds: mk(moundGeo, new THREE.MeshStandardMaterial({ color: "#2e2419", roughness: 1 }), true),
    };
  }, []);

  useFrame(() => {
    const w = experiment.world.state;
    if (w.foodVersion === version.current) return;
    version.current = w.foodVersion;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let na = 0;
    let nb = 0;
    let nm = 0;
    const t = experiment.world.terrain;
    for (const f of w.foodSources) {
      const rng = mulberry32(hashString(f.id));
      const units = Math.floor(f.amount);
      if (f.kind === "acorn") {
        for (let i = 0; i < Math.min(units, 10) && na < MAX; i++) {
          const a = rng() * Math.PI * 2;
          const r = Math.sqrt(rng()) * 0.9;
          p.set(f.position.x + Math.cos(a) * r, 0, f.position.z + Math.sin(a) * r);
          p.y = t.height(p.x, p.z) - 0.004;
          q.setFromEuler(new THREE.Euler(Math.PI / 2 + (rng() - 0.5) * 0.4, rng() * 6.28, 0));
          s.setScalar(0.9 + rng() * 0.3);
          m.compose(p, q, s);
          acorns.setMatrixAt(na, m);
          caps.setMatrixAt(na, m);
          na++;
        }
      } else if (f.kind === "berry") {
        const obj = f.objectId ? w.objects.find((o) => o.id === f.objectId) : undefined;
        const center = obj ? obj.position : f.position;
        const radius = obj ? obj.radius : 0.8;
        for (let i = 0; i < Math.min(units * 6, 40) && nb < MAX; i++) {
          const a = rng() * Math.PI * 2;
          const r = radius * (0.5 + rng() * 0.5);
          p.set(center.x + Math.cos(a) * r, center.y + 0.25 + rng() * 0.9 * (obj?.scale ?? 1), center.z + Math.sin(a) * r);
          q.identity();
          s.setScalar(0.8 + rng() * 0.5);
          m.compose(p, q, s);
          berries.setMatrixAt(nb++, m);
        }
      } else if (f.kind === "cache" && units >= 1) {
        if (nm >= MAX) continue;
        p.set(f.position.x, t.height(f.position.x, f.position.z) - 0.02, f.position.z);
        q.setFromEuler(new THREE.Euler(0, rng() * 6, 0));
        const sc = f.createdBySubject ? 0.8 : 1.6;
        s.set(sc, f.createdBySubject ? 1 : 0.5, sc * 0.8);
        m.compose(p, q, s);
        mounds.setMatrixAt(nm++, m);
      }
    }
    acorns.count = na;
    caps.count = na;
    berries.count = nb;
    mounds.count = nm;
    for (const mesh of [acorns, caps, berries, mounds]) mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <primitive object={acorns} />
      <primitive object={caps} />
      <primitive object={berries} />
      <primitive object={mounds} />
    </group>
  );
}
