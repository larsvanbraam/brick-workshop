import { useMemo, useRef, useState } from 'react';
import { Download, Trash2, Upload, X } from 'lucide-react';
import {
  BUILD_AREA,
  COLORS,
  getPart,
  getPartColorStatus,
  resizeBuildArea,
} from '@brick-workshop/engine';
import type {
  Assembly,
  BuildabilityReport,
  Issue,
  PartColorEvidence,
  PhysicalAssessment,
  PhysicalData,
} from '@brick-workshop/engine';

const CHECK_STATUS = {
  passed: 'Passed (model)',
  estimated: 'Estimated',
  reported: 'Catalogue-reported',
  failed: 'Failed',
  unknown: 'Unknown',
} as const;

/** Board sizes offered for a build; the engine accepts any whole size in between. */
export const BOARD_SIZES = [BUILD_AREA, 32, 48, 64, 96, 128];

export interface PhysicalSettings {
  useCatalogMasses: boolean;
  estimateMissingMasses: boolean;
  rejectInfeasible: boolean;
}

export function DetailsPanel({
  assembly,
  bill,
  issues,
  physical,
  buildability,
  hasEnvelopeOnlyParts,
  height,
  buildArea,
  evidence,
  physicalData,
  settings,
  onSettings,
  onImportPhysics,
  onClearPhysics,
  onImportEvidence,
  onExportParts,
  onResize,
  onClose,
}: {
  assembly: Assembly;
  bill: { partId: string; color: number; quantity: number }[];
  issues: Issue[];
  physical: PhysicalAssessment;
  buildability: BuildabilityReport;
  hasEnvelopeOnlyParts: boolean;
  height: number;
  buildArea: number;
  evidence: PartColorEvidence;
  physicalData: PhysicalData;
  settings: PhysicalSettings;
  onSettings: (settings: PhysicalSettings) => void;
  onImportPhysics: (file?: File) => void;
  onClearPhysics: () => void;
  onImportEvidence: (file?: File) => void;
  onExportParts: () => void;
  onResize: (size: number) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'parts'>('overview');
  const physicalFile = useRef<HTMLInputElement>(null);
  const evidenceFile = useRef<HTMLInputElement>(null);
  const boardSizes = useMemo(
    () =>
      [...new Set([...BOARD_SIZES, buildArea])]
        .sort((a, b) => a - b)
        .map((size) => ({ size, fits: resizeBuildArea(assembly, size) !== null })),
    [assembly, buildArea],
  );
  const colorOf = (id: number) => COLORS.find((entry) => entry.id === id);
  const toggles = [
    ['useCatalogMasses', 'Use catalogue weights'],
    ['estimateMissingMasses', 'Estimate missing masses'],
    ['rejectInfeasible', 'Reject infeasible edits'],
  ] as const;

  return (
    <aside className="details-panel" aria-label="Build details">
      <header className="details-header">
        <h2>Details</h2>
        <button
          className="icon-button small"
          title="Close details"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="segmented details-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'overview'}
          aria-pressed={tab === 'overview'}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          role="tab"
          aria-selected={tab === 'parts'}
          aria-pressed={tab === 'parts'}
          onClick={() => setTab('parts')}
        >
          Parts list <span className="tab-count">{bill.length}</span>
        </button>
      </div>
      {tab === 'overview' ? (
        <div className="details-scroll">
          <div className="stat-grid">
            <div>
              <strong>{assembly.bricks.length}</strong>
              <span>Pieces</span>
            </div>
            <div>
              <strong>{new Set(assembly.bricks.map((brick) => brick.partId)).size}</strong>
              <span>Part types</span>
            </div>
            <div>
              <strong>{new Set(assembly.bricks.map((brick) => brick.color)).size}</strong>
              <span>Colors</span>
            </div>
          </div>
          <dl className="details-list">
            <div>
              <dt>Board</dt>
              <dd>
                <select
                  className="board-size"
                  aria-label="Board size"
                  value={buildArea}
                  onChange={(event) => onResize(Number(event.target.value))}
                >
                  {boardSizes.map(({ size, fits }) => (
                    <option key={size} value={size} disabled={!fits}>
                      {size} × {size} studs{fits ? '' : ' (too small)'}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{assembly.bricks.length ? (height * 3.2).toFixed(1) : '0'} mm</dd>
            </div>
            <div>
              <dt>Total mass</dt>
              <dd>
                {physical.totalMassGrams === null
                  ? 'Unknown'
                  : `${physical.massBasis === 'measured' ? '' : '~ '}${physical.totalMassGrams.toFixed(2)} g`}
              </dd>
            </div>
          </dl>

          <section className="details-card">
            <h3>Checks</h3>
            <div className={`check-row ${issues.length ? 'failed' : 'passed'}`}>
              <span className="status-dot" />
              <div>
                <strong>
                  {issues.length
                    ? `${issues.length} geometry ${issues.length === 1 ? 'issue' : 'issues'}`
                    : hasEnvelopeOnlyParts
                      ? 'Layout accepted'
                      : 'Geometry valid'}
                </strong>
                <small>
                  {issues.length
                    ? issues[0].message
                    : hasEnvelopeOnlyParts
                      ? 'Connector fit of library parts is unknown.'
                      : 'No collisions, every piece is supported.'}
                </small>
              </div>
            </div>
            <div className={`check-row ${buildability.status === 'failed' ? 'failed' : 'warning'}`}>
              <span className="status-dot" />
              <div>
                <strong>{buildability.label}</strong>
                <small>Static model only, not a buildability guarantee.</small>
              </div>
            </div>
            <details className="disclosure">
              <summary>Physical feasibility</summary>
              <dl className="details-list" aria-label="Required buildability checks">
                {buildability.checks.map((check) => (
                  <div
                    key={check.id}
                    data-check={check.id}
                    data-check-status={check.status}
                    title={check.detail}
                  >
                    <dt>{check.label}</dt>
                    <dd>{CHECK_STATUS[check.status]}</dd>
                  </div>
                ))}
                <div>
                  <dt>Gravity</dt>
                  <dd>
                    {
                      {
                        'not-assessed': 'Unknown',
                        balanced: 'Static balance',
                        'requires-clutch': 'Needs stud tension',
                        unstable: 'No equilibrium',
                      }[physical.gravity]
                    }
                  </dd>
                </div>
                <div>
                  <dt>Stud tension</dt>
                  <dd>
                    {physical.minimumStudTensionNewtons === null
                      ? 'Unknown'
                      : `${physical.minimumStudTensionNewtons.toFixed(4)} N`}
                  </dd>
                </div>
                <div>
                  <dt>Tensile limit</dt>
                  <dd>
                    {
                      {
                        unknown: 'Unknown',
                        'within-supplied-limit': 'Within supplied limit',
                        'exceeds-supplied-limit': 'Exceeded',
                      }[physical.connectionStrength]
                    }
                  </dd>
                </div>
                <div>
                  <dt>Mass basis</dt>
                  <dd>
                    {physical.massBasis === 'catalog' ? 'Catalogue-reported' : physical.massBasis}
                  </dd>
                </div>
              </dl>
              <div className="toggle-list">
                {toggles.map(([key, label]) => (
                  <label key={key} className="switch">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={settings[key]}
                      onChange={(event) => onSettings({ ...settings, [key]: event.target.checked })}
                    />
                  </label>
                ))}
              </div>
              <details className="disclosure nested">
                <summary>Assumptions and provenance</summary>
                <ul>
                  {[...physical.reasons, ...physical.assumptions].map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {[
                  ...new Map(physical.masses.map(({ partId, mass }) => [partId, mass])).entries(),
                ].map(([id, mass]) => (
                  <p key={id}>
                    {id}: {mass.massGrams} g / {mass.kind} / {mass.source}
                    {mass.catalog && (
                      <>
                        <br />
                        <a href={mass.catalog.url} target="_blank" rel="noreferrer">
                          BrickLink {mass.catalog.partId}
                        </a>{' '}
                        / {mass.catalog.retrievedAt}
                        <br />
                        {mass.catalog.mappingNote}
                      </>
                    )}
                  </p>
                ))}
                {physicalData.studConnection && (
                  <p>
                    Stud tension source: {physicalData.studConnection.source};{' '}
                    {physicalData.studConnection.maxTensionPerStudNewtons} N per stud / safety
                    factor {physicalData.studConnection.safetyFactor}.
                  </p>
                )}
              </details>
            </details>
          </section>

          <details className="details-card disclosure">
            <summary>Data sources</summary>
            <dl className="details-list">
              <div>
                <dt>Observed combinations</dt>
                <dd>{evidence.observations.length}</dd>
              </div>
              <div>
                <dt>Mapped colors</dt>
                <dd>
                  {Object.keys(evidence.mappings.colors).length} / {COLORS.length}
                </dd>
              </div>
              <div>
                <dt>Retrieved</dt>
                <dd>
                  <a
                    href={evidence.source.url}
                    target="_blank"
                    rel="noreferrer"
                    title={evidence.source.mappingNote}
                  >
                    {evidence.source.retrievedAt.slice(0, 10)}
                  </a>
                </dd>
              </div>
            </dl>
            <input
              ref={evidenceFile}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Import part color evidence"
              onChange={(event) => {
                onImportEvidence(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <input
              ref={physicalFile}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Import physical data"
              onChange={(event) => {
                onImportPhysics(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <div className="button-row">
              <button className="secondary" onClick={() => evidenceFile.current?.click()}>
                <Upload size={14} />
                Color evidence
              </button>
              <button className="secondary" onClick={() => physicalFile.current?.click()}>
                <Upload size={14} />
                Physical data
              </button>
            </div>
            {(Object.keys(physicalData.parts).length > 0 || physicalData.studConnection) && (
              <button className="quiet" onClick={onClearPhysics}>
                <Trash2 size={14} />
                Clear physical data
              </button>
            )}
          </details>
        </div>
      ) : (
        <div className="details-scroll">
          <div className="bom-list">
            {bill.map((entry) => {
              const status = getPartColorStatus(entry.partId, entry.color, evidence);
              return (
                <div
                  className="bom-row"
                  key={`${entry.partId}:${entry.color}`}
                  title={status.reason}
                >
                  <span
                    className="bom-color"
                    style={{ backgroundColor: colorOf(entry.color)?.hex }}
                  />
                  <div>
                    <strong>{getPart(entry.partId).name}</strong>
                    <small>
                      {entry.partId} · {colorOf(entry.color)?.name}
                      {status.manufactured !== 'observed' && ' · unverified color'}
                    </small>
                  </div>
                  <span className="bom-quantity">×{entry.quantity}</span>
                </div>
              );
            })}
            {!bill.length && <p className="empty-text">No pieces yet</p>}
          </div>
          <button className="secondary" disabled={!bill.length} onClick={onExportParts}>
            <Download size={14} />
            Export parts list
          </button>
        </div>
      )}
    </aside>
  );
}
