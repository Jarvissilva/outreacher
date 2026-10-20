import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, FolderOpen, Plus } from 'lucide-react';
import type { Project } from '@outreachit/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProjectDialog } from './ProjectDialog';

export function ProjectSwitcher({
  project,
  projects,
}: {
  project: Project;
  projects: Project[];
}) {
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const section =
    ['settings', 'templates', 'campaigns', 'compose', 'inbox']
      .find((section) =>
        location.pathname.startsWith(`/projects/${project.id}/${section}`),
      )
      ?.replace(/^/, '/') ?? '';
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between"
            aria-label={`Switch project: ${project.name}`}
          >
            <span className="truncate">{project.name}</span>
            <ChevronsUpDown className="shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => navigate(`/projects/${item.id}${section}`)}
            >
              <span className="flex-1 truncate">{item.name}</span>
              {item.id === project.id && <Check />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            Create new project
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/')}>
            <FolderOpen />
            All projects
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {creating && (
        <ProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(created) => navigate(`/projects/${created.id}`)}
        />
      )}
    </>
  );
}
