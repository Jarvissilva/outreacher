import { EmailSettings } from '@/components/settings/EmailSettings';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { Project } from '@outreachit/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ProjectDialog } from '@/components/projects/ProjectDialog';
import { CustomFieldsSettings } from '@/components/settings/CustomFieldsSettings';

export function SettingsPage() {
  const project = useOutletContext<Project>();
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <div className="page-heading">
        <h1>Settings</h1>
      </div>
      <Card className="mb-8">
        <CardContent className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm">Project name</h2>
            <p className="mt-1 break-words text-sm">{project.name}</p>
          </div>
          <Button variant="outline" onClick={() => setRenaming(true)}>
            Rename project
          </Button>
        </CardContent>
      </Card>
      <EmailSettings projectId={project.id} />
      <section id="custom-fields" aria-labelledby="custom-fields-heading">
        <CustomFieldsSettings projectId={project.id} />
      </section>
      {renaming && (
        <ProjectDialog project={project} onClose={() => setRenaming(false)} />
      )}
    </>
  );
}
