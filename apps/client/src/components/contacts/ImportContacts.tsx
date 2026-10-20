import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle2 } from 'lucide-react';
import {
  csvColumns,
  csvHeadersSchema,
  importPreviewSchema,
  importResultSchema,
} from '@outreachit/shared';
import type { CustomField } from '@outreachit/shared';
import { api } from '@/lib/api';
import { invalidateProject } from '@/lib/projects';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';

export function ImportContacts({
  projectId,
  customFields,
  onClose,
}: {
  projectId: string;
  customFields: CustomField[];
  onClose(): void;
}) {
  const queryClient = useQueryClient();
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
  const preview = useMutation({
    mutationFn: () =>
      api(
        `/projects/${projectId}/contacts/import/preview`,
        importPreviewSchema,
        'POST',
        {
          csv,
          mapping,
        },
      ),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 1_000_000)
        throw new Error('Choose a CSV smaller than 1 MB.');
      const text = await file.text();
      const data = await api(
        `/projects/${projectId}/contacts/import/headers`,
        csvHeadersSchema,
        'POST',
        { csv: text },
      );
      return { text, headers: data.headers, name: file.name };
    },
    onSuccess: (data) => {
      setCsv(data.text);
      setHeaders(data.headers);
      setFilename(data.name);
      const autoMapping: Record<string, string> = {};
      for (const column of columns) {
        const match = data.headers.find(
          (header) =>
            header.toLowerCase().replace(/[\s_-]/g, '') ===
            column.key.replace('custom.', '').toLowerCase(),
        );
        if (match) autoMapping[column.key] = match;
      }
      setMapping(autoMapping);
      preview.reset();
    },
  });
  const commit = useMutation({
    mutationFn: () =>
      api(
        `/projects/${projectId}/contacts/import`,
        importResultSchema,
        'POST',
        {
          csv,
          mapping,
        },
      ),
    onSuccess: async () => {
      await invalidateProject(queryClient, projectId);
    },
  });
  return (
    <Modal
      title="Import contacts"
      description="Map your columns, review the results, then import."
      onClose={() => {
        if (!commit.isPending) onClose();
      }}
      wide
    >
      <div className="modal-body">
        <ErrorMessage error={upload.error ?? preview.error ?? commit.error} />
        {commit.isSuccess ? (
          <div className="import-success">
            <CheckCircle2 size={36} />
            <h3>Import complete</h3>
            <p>
              {commit.data.imported} added · {commit.data.duplicates} duplicates
              skipped · {commit.data.invalid} invalid rows skipped
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
                  upload.isPending || preview.isPending || commit.isPending
                }
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    preview.reset();
                    setHeaders([]);
                    setCsv('');
                    upload.mutate(file);
                  }
                }}
              />
            </label>
            {upload.isPending && (
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
                        disabled={preview.isPending || commit.isPending}
                        onChange={(event) => {
                          const next = { ...mapping };
                          if (event.target.value)
                            next[column.key] = event.target.value;
                          else delete next[column.key];
                          setMapping(next);
                          preview.reset();
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
            {preview.data && (
              <div className="import-preview">
                <h3>Review your import</h3>
                <p>
                  {preview.data.ready} ready · {preview.data.duplicates}{' '}
                  duplicates · {preview.data.invalid} invalid
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
                      {preview.data.rows.map((row) => (
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
                {preview.data.total > 50 && (
                  <p className="muted">
                    Showing the first 50 rows of {preview.data.total}.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="outline" onClick={onClose} disabled={commit.isPending}>
          {commit.isSuccess ? 'Done' : 'Cancel'}
        </Button>
        {!commit.isSuccess &&
          (preview.data ? (
            <Button
              disabled={!preview.data.ready || commit.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending
                ? 'Importing…'
                : `Import ${preview.data.ready} contacts`}
            </Button>
          ) : (
            <Button
              disabled={
                !mapping.email || !csv || preview.isPending || upload.isPending
              }
              onClick={() => preview.mutate()}
            >
              {preview.isPending ? 'Checking…' : 'Preview import'}
            </Button>
          ))}
      </div>
    </Modal>
  );
}
