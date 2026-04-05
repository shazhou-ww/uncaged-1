import { useState, useCallback, useRef, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { cn } from '../../lib/utils'
import type { ToolSearchResult } from '../../lib/api'

interface SchemaFormProps {
  tool: ToolSearchResult
  onSubmit: (args: Record<string, unknown>) => void
  onCancel: () => void
  submitting?: boolean
}

interface SchemaProperty {
  type?: string
  description?: string
  default?: unknown
  enum?: string[]
  format?: string
  'x-form-multiline'?: boolean
  'x-form-accept'?: string
}

export function SchemaForm({ tool, onSubmit, onCancel, submitting }: SchemaFormProps) {
  const schema = (tool.inputSchema ?? {}) as {
    properties?: Record<string, SchemaProperty>
    required?: string[]
  }
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const fieldKeys = Object.keys(properties)

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) init[key] = prop.default
      else if (prop.type === 'boolean') init[key] = false
      else init[key] = ''
    }
    return init
  })

  const formRef = useRef<HTMLFormElement>(null)

  const updateField = useCallback((key: string, value: unknown) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      // Build args, converting types
      const args: Record<string, unknown> = {}
      for (const [key, prop] of Object.entries(properties)) {
        let val = values[key]
        if (prop.type === 'number' && typeof val === 'string') {
          val = val === '' ? undefined : Number(val)
        }
        if (val !== undefined && val !== '') args[key] = val
      }
      onSubmit(args)
    },
    [values, properties, onSubmit],
  )

  return (
    <motion.div
      className="bg-surface-2 border border-border rounded-lg overflow-hidden"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span className="text-xl">{tool.icon || '🔧'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text truncate">{tool.name}</div>
          <div className="text-xs text-text-3 truncate">{tool.description}</div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="w-7 h-7 rounded-full flex items-center justify-center text-text-3 hover:text-text hover:bg-white/[0.06] transition-colors duration-200 cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Form body */}
      <form ref={formRef} onSubmit={handleSubmit}>
        <div className="px-4 py-3 flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
          {fieldKeys.length === 0 ? (
            <div className="text-sm text-text-4 text-center py-2">
              该工具无需参数
            </div>
          ) : (
            fieldKeys.map(key => {
              const prop = properties[key]
              const isRequired = required.has(key)
              return (
                <FieldRenderer
                  key={key}
                  fieldKey={key}
                  prop={prop}
                  value={values[key]}
                  required={isRequired}
                  onChange={v => updateField(key, v)}
                />
              )
            })
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium',
              'text-text-3 hover:text-text hover:bg-white/[0.06]',
              'transition-colors duration-200 cursor-pointer',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={cn(
              'px-5 py-1.5 rounded-full text-sm font-medium',
              'bg-gradient-to-r from-accent to-accent-2 text-bg',
              'hover:shadow-[0_0_20px_var(--color-accent-glow)] hover:scale-105',
              'transition-all duration-200 cursor-pointer',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none',
            )}
          >
            {submitting ? '执行中…' : '执行'}
          </button>
        </div>
      </form>
    </motion.div>
  )
}

/* ── Field Renderer ─────────────────────────────────────────────── */

function FieldRenderer({
  fieldKey,
  prop,
  value,
  required,
  onChange,
}: {
  fieldKey: string
  prop: SchemaProperty
  value: unknown
  required: boolean
  onChange: (v: unknown) => void
}) {
  const label = fieldKey
  const description = prop.description

  const inputClasses = cn(
    'w-full bg-surface-3 rounded-lg px-3 py-2 text-sm text-text',
    'placeholder:text-text-4 outline-none',
    'ring-1 ring-white/[0.06] transition-shadow duration-300',
    'focus:ring-1 focus:ring-accent/60 focus:shadow-[0_0_12px_var(--color-accent-glow)]',
  )

  // Boolean → toggle
  if (prop.type === 'boolean') {
    return (
      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <div className="flex-1 min-w-0">
          <FieldLabel label={label} required={required} />
          {description && (
            <div className="text-xs text-text-4 mt-0.5">{description}</div>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(!value)}
          className={cn(
            'w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0 relative cursor-pointer',
            value ? 'bg-accent' : 'bg-surface-3 ring-1 ring-white/[0.06]',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200',
              value ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </label>
    )
  }

  // Enum → select
  if (prop.enum && prop.enum.length > 0) {
    return (
      <div>
        <FieldLabel label={label} required={required} />
        {description && (
          <div className="text-xs text-text-4 mt-0.5 mb-1">{description}</div>
        )}
        <select
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          className={cn(inputClasses, 'cursor-pointer')}
        >
          <option value="">选择…</option>
          {prop.enum.map(opt => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // File upload
  if (prop.format === 'uri' || prop['x-form-accept']) {
    return (
      <div>
        <FieldLabel label={label} required={required} />
        {description && (
          <div className="text-xs text-text-4 mt-0.5 mb-1">{description}</div>
        )}
        <div
          className={cn(
            'w-full border-2 border-dashed border-border-2 rounded-lg p-4',
            'text-center text-sm text-text-4 cursor-pointer',
            'hover:border-accent/40 transition-colors duration-200',
          )}
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            if (prop['x-form-accept']) input.accept = prop['x-form-accept']
            input.onchange = () => {
              const file = input.files?.[0]
              if (file) onChange(file.name)
            }
            input.click()
          }}
        >
          {value ? String(value) : '点击选择文件'}
        </div>
      </div>
    )
  }

  // Number
  if (prop.type === 'number' || prop.type === 'integer') {
    return (
      <div>
        <FieldLabel label={label} required={required} />
        {description && (
          <div className="text-xs text-text-4 mt-0.5 mb-1">{description}</div>
        )}
        <input
          type="number"
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          placeholder={description || label}
          className={inputClasses}
        />
      </div>
    )
  }

  // Multiline text
  if (prop['x-form-multiline']) {
    return (
      <div>
        <FieldLabel label={label} required={required} />
        {description && (
          <div className="text-xs text-text-4 mt-0.5 mb-1">{description}</div>
        )}
        <textarea
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          placeholder={description || label}
          rows={3}
          className={cn(inputClasses, 'resize-none')}
        />
      </div>
    )
  }

  // Default: string text input
  return (
    <div>
      <FieldLabel label={label} required={required} />
      {description && (
        <div className="text-xs text-text-4 mt-0.5 mb-1">{description}</div>
      )}
      <input
        type="text"
        value={String(value ?? '')}
        onChange={e => onChange(e.target.value)}
        placeholder={description || label}
        className={inputClasses}
      />
    </div>
  )
}

function FieldLabel({ label, required }: { label: string; required: boolean }) {
  return (
    <div className="text-sm font-medium text-text-2 mb-1">
      {label}
      {required && <span className="text-accent ml-0.5">*</span>}
    </div>
  )
}
