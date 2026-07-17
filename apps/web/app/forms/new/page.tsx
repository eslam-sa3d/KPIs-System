'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  ArrowDown,
  ArrowUp,
  Asterisk,
  CheckCircle2,
  CircleDashed,
  Copy,
  MoreVertical,
  Plus,
  SeparatorHorizontal,
  Trash2,
} from 'lucide-react';
import { SCORE_FIELD_TYPES } from '@pulse/contracts';
import { PortalShell } from '../../../components/portal-shell';
import { KpiLinkCombobox } from '../../../components/kpi-link-combobox';
import { SubCriteriaPickerCombobox } from '../../../components/sub-criteria-picker-combobox';
import { LoadingState } from '../../../components/loading-state';
import { assetUrl, uploadAsset } from '../../../lib/api-client';
import { useSession } from '../../../lib/use-session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FIELD_TYPE_OPTIONS, FIELD_TYPE_ICON } from './constants';
import { FieldOptionsEditor } from './field-options-editor';
import { PageBreakCard } from './page-break-card';
import { SectionAfterCard } from './section-after-card';
import { SortableCard } from './sortable-card';
import { useFormBuilder } from './use-form-builder';

function NewFormPage() {
  const user = useSession();
  const editSlug = useSearchParams().get('edit');
  const {
    title,
    setTitle,
    description,
    setDescription,
    fields,
    activeFieldIndex,
    setActiveFieldIndex,
    fieldRefs,
    dragSensors,
    error,
    published,
    sectionsEnabled,
    toggleSectionsEnabled,
    importing,
    importIssues,
    fileInputRef,
    editingForm,
    loadingExisting,
    kpis,
    kpiLinkErrors,
    kpiPanelOverrides,
    branchingPanelOverrides,
    keyedFields,
    canLinkKpis,
    resolvedSections,
    splitPageHere,
    updateSection,
    removeSection,
    updateField,
    markAllRequired,
    markAllOptional,
    addAllUsersAsOptions,
    toggleKpiPanel,
    toggleBranchingPanel,
    onLinkFieldToKpi,
    onUnlinkFieldFromKpi,
    moveField,
    duplicateField,
    removeField,
    addField,
    onFieldDragEnd,
    onOptionDragEnd,
    onImportExcel,
    onUploadSectionMedia,
    onPublish,
  } = useFormBuilder(user, editSlug);

  if (loadingExisting) {
    return (
      <PortalShell user={user}>
        <h1>Edit form</h1>
        <LoadingState />
      </PortalShell>
    );
  }

  if (published) {
    return (
      <PortalShell user={user}>
        <h1 className="published-heading">
          <CheckCircle2 size={26} aria-hidden="true" className="published-heading-icon" />
          Published
        </h1>
        <p className="portal-subtitle">Your form is live and accepting submissions.</p>
        <div className="page-title-row">
          <Link href={`/forms/view?slug=${encodeURIComponent(published.slug)}`} className="btn-primary">
            Open form
          </Link>
          <Link href="/forms" className="btn-ghost">
            Back to forms
          </Link>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell user={user}>
      <div className="msform">
        <header className="msform-banner msform-banner-edit">
          <div className="msform-edit-badge">
            <Link href={editingForm ? `/forms/view?slug=${encodeURIComponent(editingForm.slug)}` : '/forms'}>
              ← back to {editingForm ? 'form' : 'forms'}
            </Link>
            {editingForm && <span>Editing an existing form — publishing saves a new version</span>}
          </div>
          <label htmlFor="form-title">Form title</label>
          <Input
            id="form-title"
            className="msform-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled form"
          />
          <label htmlFor="form-description" className="msform-desc-label">
            Description (optional)
          </label>
          <Input
            id="form-description"
            className="msform-desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell respondents what this form is for"
          />
        </header>

        <div className="builder msform-body">
          <div className="admin-card" style={{ marginBottom: 12 }}>
            <span className="field-label">Import questions from a file</span>
            <Input
              ref={fileInputRef}
              id="excel-import-input"
              type="file"
              accept=".xlsx,.xls,.csv,.docx"
              onChange={onImportExcel}
              style={{ display: 'none' }}
            />
            <Button type="button" variant="ghost" disabled={importing} onClick={() => fileInputRef.current?.click()}>
              {importing ? 'Reading file…' : 'Import from Excel, CSV, or Word'}
            </Button>
            {importIssues.length > 0 && (
              <ul className="muted" style={{ fontSize: 12, margin: '8px 0 0', paddingLeft: 18 }}>
                {importIssues.slice(0, 5).map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
                {importIssues.length > 5 && <li>…and {importIssues.length - 5} more</li>}
              </ul>
            )}
          </div>

          {fields.length > 0 && (
            <div className="page-title-row" style={{ marginBottom: 8 }}>
              <Button type="button" variant="ghost" onClick={markAllRequired}>
                <Asterisk size={14} aria-hidden="true" />
                Mark all required
              </Button>
              <Button type="button" variant="ghost" onClick={markAllOptional}>
                <CircleDashed size={14} aria-hidden="true" />
                Mark all optional
              </Button>
            </div>
          )}

          <div className="builder-fields-row">
            <div className="builder-fields-col">
              <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={onFieldDragEnd}>
                <SortableContext items={fields.map((_, i) => i)} strategy={verticalListSortingStrategy}>
                  {fields.map((field, index) => {
                    const isActive = activeFieldIndex === index;
                    const fieldKey = keyedFields[index]?.key ?? '';
                    // "go to section based on answer" only makes sense once there's a LATER page to jump to.
                    const ownSectionIndex = sectionsEnabled
                      ? resolvedSections.findIndex((s) => s.fieldKeys.includes(fieldKey))
                      : -1;
                    const ownSection = ownSectionIndex >= 0 ? resolvedSections[ownSectionIndex] : undefined;
                    const laterSectionsForField = ownSection ? resolvedSections.slice(ownSectionIndex + 1) : [];
                    // this question is literally where its page begins/ends — drives the inline page
                    // header/footer rendered around its card, and whether "split a new page here" is offered
                    const isPageStart = ownSection?.fieldKeys[0] === fieldKey;
                    const isPageEnd = ownSection
                      ? ownSection.fieldKeys[ownSection.fieldKeys.length - 1] === fieldKey
                      : false;
                    const pageDisplayIndex = ownSection ? resolvedSections.indexOf(ownSection) : -1;
                    // Any answerable question can be linked to a KPI — section_header is the only
                    // exclusion, since it has no answer at all. Whether the link actually produces a
                    // live score depends on the field type; see kpiProducesLiveScore below.
                    const canLinkKpiField = field.type !== 'section_header';
                    // Only these types have a well-defined 0-5 normalization (see form-kpi-scoring.service.ts's
                    // normalizeScore) — linking any other type is allowed, but never produces a score.
                    const kpiProducesLiveScore = (SCORE_FIELD_TYPES as readonly string[]).includes(field.type);
                    // "link to KPI" panel visibility: an explicit toggle (via the ⋮ menu) overrides the
                    // default of "open if already linked" — so an existing link stays visible without
                    // requiring the toggle, but can still be tucked away once reviewed.
                    const kpiOpen = kpiPanelOverrides.has(index) ? kpiPanelOverrides.get(index)! : Boolean(field.kpiId);
                    // "go to section based on answer" panel visibility — same explicit-toggle-with-
                    // default-open-if-already-set pattern as kpiOpen above.
                    const branchingOpen = branchingPanelOverrides.has(index)
                      ? branchingPanelOverrides.get(index)!
                      : Object.values(field.optionGoTo).some((v) => v);
                    return (
                      <Fragment key={index}>
                        {isPageStart && ownSection && (
                          <PageBreakCard
                            section={ownSection}
                            pageDisplayIndex={pageDisplayIndex}
                            totalPages={resolvedSections.length}
                            onRemove={() => removeSection(ownSection.id)}
                            onUpdate={(patch) => updateSection(ownSection.id, patch)}
                            onUploadMedia={(file) => onUploadSectionMedia(ownSection.id, file)}
                          />
                        )}
                        <SortableCard
                          key={index}
                          id={index}
                          className={`builder-field question-card${isActive ? ' is-active' : ''}`}
                          onFocus={() => setActiveFieldIndex(index)}
                          onClick={() => setActiveFieldIndex(index)}
                          setRef={(el) => {
                            fieldRefs.current[index] = el;
                          }}
                        >
                          {(drag) => (
                            <>
                              <legend className="field-legend">
                                <span className="question-number">{index + 1}</span>
                              </legend>

                              <Button
                                type="button"
                                variant="ghost"
                                className="field-drag-handle"
                                title="Drag to reorder"
                                aria-label="Drag to reorder"
                                {...drag.attributes}
                                {...drag.listeners}
                              >
                                <span className="field-drag-dots">
                                  <span />
                                  <span />
                                  <span />
                                  <span />
                                  <span />
                                  <span />
                                </span>
                              </Button>

                              <div className="field-head-row">
                                <div className="field-title-group">
                                  <label htmlFor={`field-label-${index}`}>Field label</label>
                                  <Input
                                    id={`field-label-${index}`}
                                    className="field-title-input"
                                    value={field.label}
                                    onChange={(e) => updateField(index, { label: e.target.value })}
                                    placeholder="Untitled question"
                                  />
                                  <SubCriteriaPickerCombobox
                                    kpis={kpis}
                                    onSelect={(subCriteria) => updateField(index, { label: subCriteria.name })}
                                  />
                                </div>
                                <div className="field-type-group">
                                  <label htmlFor={`field-type-${index}`}>Field type</label>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button id={`field-type-${index}`} type="button" className="field-type-summary">
                                        <span className="field-type-icon">{FIELD_TYPE_ICON[field.type]}</span>
                                        <span className="field-type-summary-label">
                                          {FIELD_TYPE_OPTIONS.find((option) => option.value === field.type)?.label}
                                        </span>
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent aria-label="Field type">
                                      {FIELD_TYPE_OPTIONS.map((option) => (
                                        <DropdownMenuItem
                                          key={option.value}
                                          className={`field-type-option${field.type === option.value ? ' is-selected' : ''}`}
                                          onSelect={() => {
                                            updateField(index, { type: option.value });
                                          }}
                                        >
                                          <span className="field-type-icon">{FIELD_TYPE_ICON[option.value]}</span>
                                          {option.label}
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>

                              <div className={`field-detail-wrap${isActive ? ' is-open' : ''}`}>
                                <div className="field-detail-inner">
                                  {(field.type === 'select' ||
                                    field.type === 'multi_select' ||
                                    field.type === 'ranking') && (
                                    <FieldOptionsEditor
                                      field={field}
                                      fieldIndex={index}
                                      dragSensors={dragSensors}
                                      laterSectionsForField={laterSectionsForField}
                                      branchingOpen={branchingOpen}
                                      updateField={updateField}
                                      onOptionDragEnd={onOptionDragEnd}
                                      addAllUsersAsOptions={addAllUsersAsOptions}
                                    />
                                  )}

                                  {field.type === 'select' && (
                                    <>
                                      <label htmlFor={`field-layout-${index}`}>Layout</label>
                                      <Select
                                        value={field.layout}
                                        onValueChange={(v) => updateField(index, { layout: v as 'dropdown' | 'radio' })}
                                      >
                                        <SelectTrigger id={`field-layout-${index}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="dropdown">Dropdown</SelectItem>
                                          <SelectItem value="radio">Radio buttons</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </>
                                  )}

                                  {field.type === 'likert' && (
                                    <>
                                      <label htmlFor={`field-options-${index}`}>Statements (comma-separated)</label>
                                      <Input
                                        id={`field-options-${index}`}
                                        value={field.options}
                                        onChange={(e) => updateField(index, { options: e.target.value })}
                                        placeholder="Tooling quality, delivery pace"
                                      />
                                      <label htmlFor={`field-scale-${index}`}>Scale labels (comma-separated)</label>
                                      <Input
                                        id={`field-scale-${index}`}
                                        value={field.likertScale}
                                        onChange={(e) => updateField(index, { likertScale: e.target.value })}
                                        placeholder="Disagree, neutral, agree"
                                      />
                                    </>
                                  )}

                                  {field.type === 'grid' && (
                                    <>
                                      <label htmlFor={`field-grid-rows-${index}`}>Rows (comma-separated)</label>
                                      <Input
                                        id={`field-grid-rows-${index}`}
                                        value={field.gridRows}
                                        onChange={(e) => updateField(index, { gridRows: e.target.value })}
                                        placeholder="Communication, responsiveness, quality"
                                      />
                                      <label htmlFor={`field-grid-columns-${index}`}>Columns (comma-separated)</label>
                                      <Input
                                        id={`field-grid-columns-${index}`}
                                        value={field.gridColumns}
                                        onChange={(e) => updateField(index, { gridColumns: e.target.value })}
                                        placeholder="Poor, fair, good, excellent"
                                      />
                                      <label htmlFor={`field-grid-selection-${index}`}>Answers per row</label>
                                      <Select
                                        value={field.gridSelection}
                                        onValueChange={(v) =>
                                          updateField(index, { gridSelection: v as 'single' | 'multiple' })
                                        }
                                      >
                                        <SelectTrigger id={`field-grid-selection-${index}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="single">One answer (multiple choice grid)</SelectItem>
                                          <SelectItem value="multiple">Multiple answers (checkbox grid)</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <span className="builder-required">
                                        <Checkbox
                                          id={`field-grid-require-row-${index}`}
                                          checked={field.gridRequireOnePerRow}
                                          onCheckedChange={(checked) =>
                                            updateField(index, { gridRequireOnePerRow: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-grid-require-row-${index}`}>
                                          Require a response in each row
                                        </label>
                                      </span>
                                    </>
                                  )}

                                  {field.type === 'file' && (
                                    <>
                                      <label htmlFor={`field-mime-${index}`}>
                                        Accepted file types (comma-separated MIME types)
                                      </label>
                                      <Input
                                        id={`field-mime-${index}`}
                                        value={field.acceptedMimeTypes}
                                        onChange={(e) => updateField(index, { acceptedMimeTypes: e.target.value })}
                                        placeholder="Application/pdf, image/png, image/jpeg"
                                      />
                                      <label htmlFor={`field-maxsize-${index}`}>Max file size (MB, up to 25)</label>
                                      <Input
                                        id={`field-maxsize-${index}`}
                                        type="number"
                                        min={1}
                                        max={25}
                                        value={field.maxSizeMb}
                                        onChange={(e) => updateField(index, { maxSizeMb: Number(e.target.value) })}
                                      />
                                      <label htmlFor={`field-maxfiles-${index}`}>Max number of files (up to 10)</label>
                                      <Input
                                        id={`field-maxfiles-${index}`}
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={field.maxFiles}
                                        onChange={(e) => updateField(index, { maxFiles: Number(e.target.value) })}
                                      />
                                    </>
                                  )}

                                  {field.type === 'rating' && (
                                    <>
                                      <label htmlFor={`field-scale-n-${index}`}>Scale (2–10)</label>
                                      <Input
                                        id={`field-scale-n-${index}`}
                                        type="number"
                                        min={2}
                                        max={10}
                                        value={field.scale}
                                        onChange={(e) => updateField(index, { scale: Number(e.target.value) })}
                                      />
                                      <label htmlFor={`field-rating-style-${index}`}>Style</label>
                                      <Select
                                        value={field.ratingStyle}
                                        onValueChange={(v) =>
                                          updateField(index, { ratingStyle: v as 'pills' | 'stars' })
                                        }
                                      >
                                        <SelectTrigger id={`field-rating-style-${index}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="pills">Numbered pills</SelectItem>
                                          <SelectItem value="stars">Stars</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </>
                                  )}

                                  {field.type === 'slider' && (
                                    <>
                                      <label htmlFor={`field-slider-min-${index}`}>Minimum</label>
                                      <Input
                                        id={`field-slider-min-${index}`}
                                        type="number"
                                        value={field.sliderMin}
                                        onChange={(e) => updateField(index, { sliderMin: Number(e.target.value) })}
                                      />
                                      <label htmlFor={`field-slider-max-${index}`}>Maximum</label>
                                      <Input
                                        id={`field-slider-max-${index}`}
                                        type="number"
                                        value={field.sliderMax}
                                        onChange={(e) => updateField(index, { sliderMax: Number(e.target.value) })}
                                      />
                                      <label htmlFor={`field-slider-step-${index}`}>Step</label>
                                      <Input
                                        id={`field-slider-step-${index}`}
                                        type="number"
                                        min={0.01}
                                        value={field.sliderStep}
                                        onChange={(e) => updateField(index, { sliderStep: Number(e.target.value) })}
                                      />
                                    </>
                                  )}

                                  {(field.type === 'rating' || field.type === 'nps' || field.type === 'slider') && (
                                    <>
                                      <label htmlFor={`field-low-${index}`}>Low-end label (optional)</label>
                                      <Input
                                        id={`field-low-${index}`}
                                        value={field.lowLabel}
                                        onChange={(e) => updateField(index, { lowLabel: e.target.value })}
                                        placeholder="Not likely"
                                      />
                                      <label htmlFor={`field-high-${index}`}>High-end label (optional)</label>
                                      <Input
                                        id={`field-high-${index}`}
                                        value={field.highLabel}
                                        onChange={(e) => updateField(index, { highLabel: e.target.value })}
                                        placeholder="Extremely likely"
                                      />
                                    </>
                                  )}

                                  {canLinkKpis && canLinkKpiField && kpiOpen && (
                                    <div className="field-subpanel">
                                      <span className="muted" style={{ fontSize: 12 }}>
                                        Link to KPI (optional)
                                      </span>
                                      {!kpiProducesLiveScore && (
                                        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                                          This question type has no numeric answer, so linking it won't produce an
                                          automatic score — use rating, NPS, slider, number, yes/no, choice, checkboxes,
                                          or likert questions for that.
                                        </p>
                                      )}
                                      <label htmlFor={`field-kpi-${index}`}>KPI</label>
                                      <KpiLinkCombobox
                                        kpis={kpis}
                                        kpiId={field.kpiId}
                                        evaluationAreaId={field.evaluationAreaId}
                                        subCriteriaId={field.subCriteriaId}
                                        onSelect={(kpiId, evaluationAreaId, subCriteriaId) =>
                                          void onLinkFieldToKpi(index, kpiId, evaluationAreaId, subCriteriaId)
                                        }
                                        onClear={() => void onUnlinkFieldFromKpi(index)}
                                      />
                                      {kpiLinkErrors[index] && (
                                        <p role="alert" className="form-error" style={{ fontSize: 12, marginTop: 4 }}>
                                          {kpiLinkErrors[index]}
                                        </p>
                                      )}
                                    </div>
                                  )}

                                  {field.type === 'contact_info' && (
                                    <>
                                      <span className="builder-required">
                                        <Checkbox
                                          id={`field-req-name-${index}`}
                                          checked={field.requireName}
                                          onCheckedChange={(checked) =>
                                            updateField(index, { requireName: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-req-name-${index}`}>Require name</label>
                                      </span>
                                      <span className="builder-required">
                                        <Checkbox
                                          id={`field-req-email-${index}`}
                                          checked={field.requireEmail}
                                          onCheckedChange={(checked) =>
                                            updateField(index, { requireEmail: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-req-email-${index}`}>Require email</label>
                                      </span>
                                      <span className="builder-required">
                                        <Checkbox
                                          id={`field-req-phone-${index}`}
                                          checked={field.requirePhone}
                                          onCheckedChange={(checked) =>
                                            updateField(index, { requirePhone: checked === true })
                                          }
                                        />
                                        <label htmlFor={`field-req-phone-${index}`}>Require phone</label>
                                      </span>
                                    </>
                                  )}

                                  {field.type === 'hot_spot' && (
                                    <div className="field-subpanel">
                                      <label htmlFor={`field-hotspot-image-${index}`}>Image</label>
                                      <Input
                                        id={`field-hotspot-image-${index}`}
                                        type="file"
                                        accept="image/png,image/jpeg,image/gif,image/webp"
                                        onChange={(e) =>
                                          e.target.files?.[0] &&
                                          uploadAsset<{ id: string }>(e.target.files[0]).then((uploaded) =>
                                            updateField(index, { hotSpotAssetId: uploaded.id }),
                                          )
                                        }
                                      />
                                      {field.hotSpotAssetId && (
                                        <img
                                          src={assetUrl(field.hotSpotAssetId)}
                                          alt=""
                                          className="option-image"
                                          style={{ maxWidth: 240 }}
                                        />
                                      )}
                                      <span className="muted" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                                        Regions (x/y/width/height as % of the image)
                                      </span>
                                      {field.hotSpotRegions.map((region, ri) => (
                                        <div
                                          key={ri}
                                          className="builder-required"
                                          style={{ marginTop: 4, flexWrap: 'wrap' }}
                                        >
                                          <Input
                                            aria-label="Region label"
                                            value={region.label}
                                            placeholder="Label"
                                            style={{ width: 100 }}
                                            onChange={(e) => {
                                              const next = [...field.hotSpotRegions];
                                              next[ri] = { ...next[ri]!, label: e.target.value, value: e.target.value };
                                              updateField(index, { hotSpotRegions: next });
                                            }}
                                          />
                                          {(['x', 'y', 'width', 'height'] as const).map((axis) => (
                                            <Input
                                              key={axis}
                                              aria-label={axis}
                                              type="number"
                                              min={0}
                                              max={100}
                                              value={region[axis]}
                                              placeholder={axis}
                                              style={{ width: 60 }}
                                              onChange={(e) => {
                                                const next = [...field.hotSpotRegions];
                                                next[ri] = { ...next[ri]!, [axis]: Number(e.target.value) };
                                                updateField(index, { hotSpotRegions: next });
                                              }}
                                            />
                                          ))}
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() =>
                                              updateField(index, {
                                                hotSpotRegions: field.hotSpotRegions.filter((_, i) => i !== ri),
                                              })
                                            }
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      ))}
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        style={{ marginTop: 4 }}
                                        onClick={() =>
                                          updateField(index, {
                                            hotSpotRegions: [
                                              ...field.hotSpotRegions,
                                              {
                                                value: `region_${field.hotSpotRegions.length + 1}`,
                                                label: `Region ${field.hotSpotRegions.length + 1}`,
                                                x: 10,
                                                y: 10,
                                                width: 20,
                                                height: 20,
                                              },
                                            ],
                                          })
                                        }
                                      >
                                        + add region
                                      </Button>
                                    </div>
                                  )}

                                  <div className="builder-field-actions">
                                    <div className="field-actions-primary">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        title="Duplicate"
                                        aria-label="Duplicate question"
                                        onClick={() => duplicateField(index)}
                                      >
                                        <Copy size={14} aria-hidden="true" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        title="Remove field"
                                        aria-label="Remove field"
                                        onClick={() => removeField(index)}
                                      >
                                        <Trash2 size={14} aria-hidden="true" />
                                      </Button>
                                    </div>

                                    <div className="field-actions-secondary">
                                      {field.type !== 'section_header' && (
                                        <span className="builder-required field-required-toggle">
                                          <label htmlFor={`field-required-${index}`}>Required</label>
                                          <Switch
                                            id={`field-required-${index}`}
                                            checked={field.required}
                                            onCheckedChange={(checked) => updateField(index, { required: checked })}
                                          />
                                        </span>
                                      )}

                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <button
                                            type="button"
                                            className="field-kebab-summary"
                                            aria-label="More actions"
                                            title="More actions"
                                          >
                                            <MoreVertical size={16} aria-hidden="true" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent>
                                          <DropdownMenuItem
                                            disabled={index === 0}
                                            onSelect={() => {
                                              moveField(index, -1);
                                            }}
                                          >
                                            <ArrowUp size={14} aria-hidden="true" /> Move up
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            disabled={index === fields.length - 1}
                                            onSelect={() => {
                                              moveField(index, 1);
                                            }}
                                          >
                                            <ArrowDown size={14} aria-hidden="true" /> Move down
                                          </DropdownMenuItem>
                                          {sectionsEnabled && !isPageStart && (
                                            <DropdownMenuItem
                                              onSelect={() => {
                                                splitPageHere(index);
                                              }}
                                            >
                                              <SeparatorHorizontal size={14} aria-hidden="true" /> Split into a new page
                                              here
                                            </DropdownMenuItem>
                                          )}
                                          {field.type === 'select' &&
                                            sectionsEnabled &&
                                            (laterSectionsForField.length > 0 ? (
                                              <DropdownMenuCheckboxItem
                                                checked={branchingOpen}
                                                onCheckedChange={(checked) => {
                                                  toggleBranchingPanel(index, checked === true);
                                                  // Unchecking is the actual off switch, not just a UI collapse — clear
                                                  // every option's jump so a respondent's flow really does go back to
                                                  // normal, rather than leaving stale jumps active behind a hidden panel.
                                                  if (checked !== true) updateField(index, { optionGoTo: {} });
                                                }}
                                                onSelect={(e) => e.preventDefault()}
                                              >
                                                Go to section based on answer
                                              </DropdownMenuCheckboxItem>
                                            ) : (
                                              <DropdownMenuItem disabled onSelect={(e) => e.preventDefault()}>
                                                No later page to route to
                                              </DropdownMenuItem>
                                            ))}
                                          {canLinkKpis && canLinkKpiField && (
                                            <DropdownMenuCheckboxItem
                                              checked={kpiOpen}
                                              onCheckedChange={(checked) => toggleKpiPanel(index, checked === true)}
                                              onSelect={(e) => e.preventDefault()}
                                            >
                                              Link to KPI
                                            </DropdownMenuCheckboxItem>
                                          )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </SortableCard>
                        {isPageEnd && ownSection && laterSectionsForField.length > 0 && (
                          <SectionAfterCard
                            section={ownSection}
                            laterSections={laterSectionsForField}
                            onUpdate={(patch) => updateSection(ownSection.id, patch)}
                          />
                        )}
                      </Fragment>
                    );
                  })}
                </SortableContext>
              </DndContext>

              <Button type="button" variant="ghost" className="msform-add-field" onClick={() => addField()}>
                <Plus size={16} aria-hidden="true" />
                Add field
              </Button>
            </div>
          </div>

          <div className="admin-card" style={{ marginTop: 16, marginBottom: 12 }}>
            <span className="builder-required">
              <Checkbox id="sections-toggle" checked={sectionsEnabled} onCheckedChange={toggleSectionsEnabled} />
              <label htmlFor="sections-toggle">Split into pages, with branching</label>
            </span>
            {sectionsEnabled && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Open a question's ⋮ menu and choose "split into a new page here" — everything from that question onward
                moves to the new page. a "choice (one answer)" question can also send each of its own options to a
                specific later page (or submit the form early).
              </p>
            )}
          </div>

          <div className="page-title-row">
            <Button
              type="button"
              onClick={onPublish}
              disabled={
                !title.trim() ||
                fields.length === 0 ||
                fields.some((f) => !f.label.trim()) ||
                (sectionsEnabled && resolvedSections.some((s) => s.fieldKeys.length === 0))
              }
            >
              {editingForm ? 'Save changes' : 'Publish'}
            </Button>
          </div>

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </PortalShell>
  );
}

export default function NewOrEditFormPage() {
  // useSearchParams requires a Suspense boundary under static export
  return (
    <Suspense fallback={null}>
      <NewFormPage />
    </Suspense>
  );
}
