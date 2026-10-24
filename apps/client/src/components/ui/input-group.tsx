import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

function InputGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="group"
      data-slot="input-group"
      className={cn(
        'flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'h-8 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupAddon({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-group-addon" className={cn('flex shrink-0 items-center gap-1', className)} {...props} />;
}

export { InputGroup, InputGroupInput, InputGroupAddon };
