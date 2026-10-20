import { NavLink } from 'react-router-dom';
import { Settings, Users, Mail, Send } from 'lucide-react';
import type { Project } from '@outreachit/shared';
import { useSidebar } from '@/hooks/use-sidebar';
import { Brand } from './Brand';
import { ProjectSwitcher } from '@/components/projects/ProjectSwitcher';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

export function ProjectSidebar({
  project,
  projects,
}: {
  project: Project;
  projects: Project[];
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar>
      <SidebarHeader className="gap-4 p-4">
        <Brand />
        <ProjectSwitcher project={project} projects={projects} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <nav aria-label="Project navigation">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild><NavLink to={`/projects/${project.id}/inbox`} onClick={() => setOpenMobile(false)}><Mail /><span>Inbox</span></NavLink></SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild><NavLink to={`/projects/${project.id}/compose`} onClick={() => setOpenMobile(false)}><Mail /><span>Compose</span></NavLink></SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to={`/projects/${project.id}`}
                    end
                    onClick={() => setOpenMobile(false)}
                  >
                    <Users />
                    <span>Contacts</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to={`/projects/${project.id}/templates`}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Mail />
                    <span>Templates</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to={`/projects/${project.id}/campaigns`}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Send />
                    <span>Campaigns</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to={`/projects/${project.id}/settings`}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Settings />
                    <span>Settings</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
