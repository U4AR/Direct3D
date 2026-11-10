// OpenZCAD remembers a project for the whole origin. Draw3D sessions each own
// their sketches, so boot from a matching session revision before exposing CAD.
export async function savedSessionCAD(store, current) {
  const session = store.session;
  const figures = session.desktopFigures || [], solids = session.desktopSolids || [];
  const owners = new Set([...figures, ...solids].map(item => item.projectId).filter(Boolean));
  const saved = session.activeCADProject;
  const owner = owners.size === 1 ? [...owners][0] : saved?.projectId;
  if (!owner) return current;
  const sketches = figures.filter(f => f.projectId === owner && !f.hidden);
  const bodies = solids.filter(s => s.projectId === owner);
  const matches = doc => {
    if (doc?.projectId !== owner) return false;
    const nodes = Object.values(doc.nodes || {});
    return sketches.every(f => doc.nodes?.[f.objectId] &&
      nodes.some(n => n.kind === 'sketch' && n.sketchId === f.sketchId && n.objectIds.includes(f.objectId))) &&
      bodies.every(s => doc.derived?.bodyRepresentations?.[s.bodyId] ||
        nodes.some(n => n.featureId === s.featureId || n.bodyId === s.bodyId));
  };
  const read = async name => {
    if (!name) return null;
    const asset = await store.get("assets", [session.id, name]);
    if (!asset) return null;
    const snapshot = JSON.parse(await asset.blob.text());
    return snapshot.document || snapshot;
  };
  const revision = saved?.projectId === owner ? await read(saved.asset) : null;
  if (matches(current) && (!matches(revision) || current.version >= revision.version)) return current;
  if (matches(revision)) return revision;

  // Older builds could overwrite activeCADProject with another session's ID.
  // History embeds the native feature tree, including the original entity IDs.
  const history = session.desktopHistory || [];
  const cursor = session.desktopHistoryCursor ?? history.length - 1;
  for (let i = Math.min(cursor, history.length - 1); i >= 0; i--) {
    const doc = await read(history[i].asset);
    if (matches(doc)) return doc;
  }
  // A project save may have completed before its history entry was written.
  const range = IDBKeyRange.bound([session.id,"cad/revisions/"],[session.id,"cad/revisions/\uffff"]);
  const keys = await new Promise((resolve,reject) => {
    const request = store.db.transaction("assets").objectStore("assets").getAllKeys(range);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const [,name] of keys.reverse()) {
    const doc = await read(name);
    if (matches(doc)) return doc;
  }
  throw Error("The native CAD project and saved revisions for this session do not contain its referenced geometry.");
}
