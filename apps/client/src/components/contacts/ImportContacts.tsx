import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useRouteAction } from '@/lib/route-data';
import type { CustomField } from '@outreacher/shared';
import {
  csvColumns,
  csvHeadersSchema,
  importPreviewSchema,
  importResultSchema,
} from '@outreacher/shared';
import { CheckCircle2, Upload } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

export function ImportContacts({
  projectId,
  customFields,
  onClose,
}: {
  projectId: string;
  customFields: CustomField[];
  onClose(): void;
}) {
  const operation = useRouteAction(`/projects/${projectId}?index`);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>();
  const [preview, setPreview] = useState<z.infer<typeof importPreviewSchema>>();
  const [result, setResult] = useState<z.infer<typeof importResultSchema>>();
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const columns = [
    ...csvColumns.map((key) => ({
      key,
      label: key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (letter) => letter.toUpperCase()),
    })),
    ...customFields.map((field) => ({
      key: `custom.${field.key}`,
      label: field.label,
    })),
  ];
  async function upload(file: File) {
    setBusy('upload'); setError(undefined); setPreview(undefined); setHeaders([]); setCsv('');
    try {
      if (file.size > 1_000_000) throw new Error('Choose a CSV smaller than 1 MB.');
      const text = await file.text();
      const data = await operation.submit('import-headers', { csv: text }, csvHeadersSchema);
      setCsv(text); setHeaders(data.headers); setFilename(file.name);
      const autoMapping: Record<string, string> = {};
      for (const column of columns) {
        const match = data.headers.find(header => header.toLowerCase().replace(/[\s_-]/g, '') === column.key.replace('custom.', '').toLowerCase());
        if (match) autoMapping[column.key] = match;
      }
      setMapping(autoMapping);
    } catch (e) { setError(e); } finally { setBusy(''); }
  }
  async function run(commit: boolean) {
    setBusy(commit ? 'commit' : 'preview'); setError(undefined);
    try {
      if (commit) setResult(await operation.submit('import-commit', { csv, mapping }, importResultSchema));
      else setPreview(await operation.submit('import-preview', { csv, mapping }, importPreviewSchema));
    } catch (e) { setError(e); } finally { setBusy(''); }
  }
  return (
    <Modal
      title="Import contacts"
      description="Map your columns, review the results, then import."
      onClose={() => {
        if (!(busy === 'commit')) onClose();
      }}
      wide
    >
      <div className="modal-body">
        <ErrorMessage error={error} />
        {result ? (
          <div className="import-success">
            <CheckCircle2 size={36} />
            <h3>Import complete</h3>
            <p>
              {result.imported} added · {result.duplicates} duplicates
              skipped · {result.invalid} invalid rows skipped
            </p>
          </div>
        ) : (
          <>
            <label className="upload-zone">
              <Upload size={26} />
              <strong>{filename || 'Choose a CSV file'}</strong>
              <span>Up to 2,000 rows · 1 MB · Header row required</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={
                  (busy === 'upload') || (busy === 'preview') || (busy === 'commit')
                }
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setPreview(undefined);
                    setHeaders([]);
                    setCsv('');
                    void upload(file);
                  }
                }}
              />
            </label>
            {(busy === 'upload') && (
              <p className="muted" role="status">
                Reading file…
              </p>
            )}
            {headers.length > 0 && (
              <>
                <h3 className="section-label">Match your columns</h3>
                <div className="form-grid">
                  {columns.map((column) => (
                    <label key={column.key}>
                      {column.label}
                      {column.key === 'email' && ' *'}
                      <select
                        value={mapping[column.key] ?? ''}
                        disabled={(busy === 'preview') || (busy === 'commit')}
                        onChange={(event) => {
                          const next = { ...mapping };
                          if (event.target.value)
                            next[column.key] = event.target.value;
                          else delete next[column.key];
                          setMapping(next);
                          setPreview(undefined);
                        }}
                      >
                        <option value="">Do not import</option>
                        {headers.map((header) => (
                          <option key={header}>{header}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </>
            )}
            {preview && (
              <div className="import-preview">
                <h3>Review your import</h3>
                <p>
                  {preview.ready} ready · {preview.duplicates}{' '}
                  duplicates · {preview.invalid} invalid
                </p>
                <p className="muted">
                  Existing contacts, including deleted or suppressed emails, are
                  never overwritten.
                </p>
                <div className="table-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((row) => (
                        <TableRow key={row.row}>
                          <TableCell>{row.row}</TableCell>
                          <TableCell>{row.email || '—'}</TableCell>
                          <TableCell>
                            <span
                              className={`status ${row.status === 'ready' ? 'active' : 'muted-status'}`}
                            >
                              {row.status}
                            </span>
                            {row.issues.length > 0 && (
                              <small className="row-error">
                                {row.issues.join(' ')}
                              </small>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {preview.total > 50 && (
                  <p className="muted">
                    Showing the first 50 rows of {preview.total}.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="outline" onClick={onClose} disabled={(busy === 'commit')}>
          {result ? 'Done' : 'Cancel'}
        </Button>
        {!result &&
          (preview ? (
            <Button
              disabled={!preview.ready || (busy === 'commit')}
              onClick={() => void run(true)}
            >
              {(busy === 'commit')
                ? 'Importing…'
                : `Import ${preview.ready} contacts`}
            </Button>
          ) : (
            <Button
              disabled={
                !mapping.email || !csv || (busy === 'preview') || (busy === 'upload')
              }
              onClick={() => void run(false)}
            >
              {(busy === 'preview') ? 'Checking…' : 'Preview import'}
            </Button>
          ))}
      </div>
    </Modal>
  );
}
