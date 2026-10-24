import { useId } from 'react';
import { LockKeyhole, Users, X } from 'lucide-react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

const emailSchema = z.email();

export function RecipientInput({
  addresses,
  inputValue,
  contactCount,
  readOnly,
  onAddressesChange,
  onInputChange,
  onPickContacts,
}: {
  addresses: string[];
  inputValue: string;
  contactCount: number;
  readOnly: boolean;
  onAddressesChange(value: string[]): void;
  onInputChange(value: string): void;
  onPickContacts(): void;
}) {
  const hintId = useId();
  const invalidAddresses = new Set(addresses.filter(address => !emailSchema.safeParse(address).success));

  function commit(value = inputValue) {
    const next = [...addresses];
    const seen = new Set(next.map(address => address.toLowerCase()));
    for (const address of value.split(/[\s,;]+/).filter(Boolean)) {
      if (!seen.has(address.toLowerCase())) {
        next.push(address);
        seen.add(address.toLowerCase());
      }
    }
    onAddressesChange(next);
    onInputChange('');
  }

  return (
    <div className="min-w-0 flex-1 py-2">
      <InputGroup aria-label="Recipients" className="items-start">
        <div className="flex max-h-40 min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto">
          {!readOnly && addresses.length > 0 && (
            <ul aria-label="Added email addresses" className="contents">
              {addresses.map((address, index) => (
                <li key={`${address}/${index}`} className="max-w-full">
                  <Badge variant={invalidAddresses.has(address) ? 'destructive' : 'secondary'}>
                    {invalidAddresses.has(address) && <span className="sr-only">Invalid email address:</span>}
                    <span className="truncate" title={address}>{address}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-5 shrink-0"
                      aria-label={`Remove ${address}`}
                      onClick={() => onAddressesChange(addresses.filter((_, position) => position !== index))}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <InputGroupInput
            id="compose-addresses"
            aria-label="Email addresses"
            aria-describedby={readOnly ? undefined : hintId}
            readOnly={readOnly}
            value={readOnly ? addresses.join(', ') : inputValue}
            placeholder={addresses.length ? 'Add another email…' : 'Add recipients…'}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="min-w-20 basis-36"
            onChange={event => onInputChange(event.target.value)}
            onBlur={() => { if (!readOnly && inputValue.trim()) commit(); }}
            onKeyDown={event => {
              if (readOnly || event.nativeEvent.isComposing) return;
              if (['Enter', ',', ';', ' ', 'Tab'].includes(event.key) && inputValue.trim()) {
                if (event.key !== 'Tab') event.preventDefault();
                commit();
              } else if (event.key === 'Backspace' && !inputValue && addresses.length) {
                event.preventDefault();
                onInputChange(addresses[addresses.length - 1] ?? '');
                onAddressesChange(addresses.slice(0, -1));
              }
            }}
            onPaste={event => {
              if (readOnly) return;
              const pasted = event.clipboardData.getData('text');
              if (!/[\s,;]/.test(pasted)) return;
              event.preventDefault();
              const start = event.currentTarget.selectionStart ?? inputValue.length;
              const end = event.currentTarget.selectionEnd ?? start;
              commit(inputValue.slice(0, start) + pasted + inputValue.slice(end));
            }}
          />
        </div>
        <InputGroupAddon>
          {readOnly && <LockKeyhole aria-label="Reply recipient locked" className="size-4 text-muted-foreground" />}
          <Button type="button" aria-label={contactCount ? `Contacts (${contactCount} selected)` : 'Contacts'} disabled={readOnly} size="sm" variant="ghost" onClick={onPickContacts}>
            <Users size={15} aria-hidden="true" /><span className="hidden sm:inline">Contacts</span>{contactCount > 0 && <span className="rounded bg-secondary px-1.5 text-xs">{contactCount}</span>}
          </Button>
        </InputGroupAddon>
      </InputGroup>
      {!readOnly && <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">
        {invalidAddresses.size > 0 ? 'Check the highlighted email addresses before sending.' : 'Press Enter or comma to add an email, or paste a list.'}
      </p>}
    </div>
  );
}
