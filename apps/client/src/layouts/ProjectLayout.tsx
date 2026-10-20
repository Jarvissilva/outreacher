import { Outlet, useOutletContext, useParams } from 'react-router-dom';
import type { Project } from '@outreachit/shared';
import { ProjectSidebar } from '@/components/layout/ProjectSidebar';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { NotFoundPage } from '@/pages/NotFoundPage';

function ProjectWorkspace({
  project,
  projects,
}: {
  project: Project;
  projects: Project[];
}) {
  return (
    <SidebarProvider>
      <ProjectSidebar project={project} projects={projects} />
      <SidebarInset id="main-content" className="max-w-none p-0">
        <header className="flex h-12 items-center border-b px-4 md:hidden">
          <SidebarTrigger />
        </header>
        <div className="workspace-content">
          <Outlet context={project} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
export function ProjectLayout() {
  const projects = useOutletContext<Project[]>();
  const { projectId } = useParams();
  const project = projects.find((item) => item.id === projectId);
  if (!project) return <NotFoundPage title="Project not found" />;
  return (
    <ProjectWorkspace key={project.id} project={project} projects={projects} />
  );
}
