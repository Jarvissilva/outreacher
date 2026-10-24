import { Brand } from '@/components/layout/Brand';
import { Card, CardContent } from '@/components/ui/card';
import type { Project } from '@outreacher/shared';
import { ArrowRight, FolderOpen } from 'lucide-react';
import { Link, useOutletContext } from 'react-router';

export function HomePage() {
  const projects = useOutletContext<Project[]>();
  return (
    <main id="main-content" className="project-directory">
      <Brand />
      <div className="page-heading">
        <h1>Select a project</h1>
      </div>
      <div className="project-grid">
        {projects.map((project) => (
          <Link
            key={project.id}
            to={`/projects/${project.id}`}
            className="group rounded-xl focus-visible:outline-primary"
          >
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardContent className="flex items-center gap-4">
                <FolderOpen className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">
                    {project.name}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {project.contactCount}{' '}
                    {project.contactCount === 1 ? 'contact' : 'contacts'}
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
