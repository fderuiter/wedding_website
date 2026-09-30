'use client';
import React, { useState, useRef } from 'react';
import { RegistryItem } from '../types';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { RegistryItemBaseSchema } from '../schemas';
import { apiClient } from '@/lib/apiClient';
import { FormGroup, Label, Input, FormMessage, Textarea, Checkbox } from '@/components/ui/forms';

/**
 * Props for the RegistryItemForm component.
 */
interface RegistryItemFormProps {
  /** Specifies whether the form is for adding a new item or editing an existing one. */
  mode: 'add' | 'edit';
  /** Initial values to populate the form fields, used in 'edit' mode. */
  initialValues?: Partial<RegistryItem>;
  /** The function to call when the form is submitted. */
  onSubmit: (values: Partial<RegistryItem>) => Promise<void> | void;
  /** Optional flag to indicate that the form is currently being submitted. */
  isSubmitting?: boolean;
  /** Optional custom label for the submit button. */
  submitLabel?: string;
}

const defaultValues: Partial<RegistryItem> = {
  name: '',
  description: '',
  category: '',
  price: 0,
  imageUrl: '',
  vendorUrl: '',
  quantity: 1,
  isGroupGift: false,
};

/**
 * @function RegistryItemForm
 * @description A form for adding or editing a registry item. It includes fields for all
 * item properties and a web scraper to pre-fill data from a URL.
 *
 * @param {RegistryItemFormProps} props - The props for the component.
 * @returns {JSX.Element} The rendered registry item form.
 */
const RegistryItemForm: React.FC<RegistryItemFormProps> = ({
  mode,
  initialValues = {},
  onSubmit,
  isSubmitting = false,
  submitLabel,
}) => {
  const [values, setValues] = useState<Partial<RegistryItem>>({ ...defaultValues, ...initialValues });
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeErrorDomain, setScrapeErrorDomain] = useState<'BLOCKED_BY_VENDOR' | 'URL_NOT_FOUND' | 'NETWORK_TIMEOUT' | null>(null);
  const [scrapeWarning, setScrapeWarning] = useState<string | null>(null);
  const [scrapedFaviconUrl, setScrapedFaviconUrl] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const imageUrlInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type, checked } = e.target as HTMLInputElement;
    setValues((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleApplyFallbackImage = (imgUrl: string) => {
    setValues((prev) => ({ ...prev, imageUrl: imgUrl }));
    setScrapeWarning(null);

    setTimeout(() => {
      if (!values.name) {
        nameInputRef.current?.focus();
      } else if (!values.category) {
        categoryInputRef.current?.focus();
      } else if (values.price === undefined || values.price === null || values.price === 0) {
        priceInputRef.current?.focus();
      }
    }, 50);
  };

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    setScrapeLoading(true);
    setScrapeError(null);
    setScrapeErrorDomain(null);
    setScrapeWarning(null);
    setScrapedFaviconUrl(null);

    try {
      const data = await apiClient.post('/api/registry/scrape', { url: scrapeUrl });
      
      setValues((prev) => ({
        ...prev,
        ...data,
        name: data.name ?? prev.name ?? '',
        description: data.description ?? prev.description ?? '',
        imageUrl: data.imageUrl ?? prev.imageUrl ?? '',
        imageAlt: data.imageAlt ?? prev.imageAlt ?? '',
        vendorUrl: data.vendorUrl ?? prev.vendorUrl ?? scrapeUrl ?? '',
        quantity: data.quantity ?? prev.quantity ?? 1,
      }));

      if (data.faviconUrl) {
        setScrapedFaviconUrl(data.faviconUrl);
      }

      if (!data.imageUrl) {
        setScrapeWarning('Product image was not found on the retailer website. You can apply a default placeholder image or site favicon below.');
      }

      // Move focus to first empty field
      setTimeout(() => {
        if (!data.name) {
          nameInputRef.current?.focus();
        } else if (!data.category) {
          categoryInputRef.current?.focus();
        } else if (data.price === undefined || data.price === null || data.price === 0) {
          priceInputRef.current?.focus();
        } else if (!data.imageUrl) {
          imageUrlInputRef.current?.focus();
        }
      }, 50);

    } catch (err: unknown) {
      let domain: 'BLOCKED_BY_VENDOR' | 'URL_NOT_FOUND' | 'NETWORK_TIMEOUT' | null = null;
      let message = 'An unknown error occurred during scraping.';

      if (err && typeof err === 'object') {
        const apiErr = err as any;
        message = apiErr.message || message;
        domain = apiErr.data?.details?.errorDomain || apiErr.details?.errorDomain || null;
      }

      if (!domain) {
        if (message.includes('BLOCKED_BY_VENDOR')) domain = 'BLOCKED_BY_VENDOR';
        else if (message.includes('URL_NOT_FOUND')) domain = 'URL_NOT_FOUND';
        else if (message.includes('NETWORK_TIMEOUT')) domain = 'NETWORK_TIMEOUT';
      }

      setScrapeErrorDomain(domain);

      let friendlyMessage = message;
      if (domain === 'BLOCKED_BY_VENDOR') {
        const lowerUrl = scrapeUrl.toLowerCase();
        if (lowerUrl.includes('costco.com')) {
          friendlyMessage = 'Costco blocks automated product imports. Please enter item details manually below.';
        } else if (lowerUrl.includes('target.com')) {
          friendlyMessage = 'Target blocks automated product imports. Please enter item details manually below.';
        } else if (lowerUrl.includes('amazon.com')) {
          friendlyMessage = 'Amazon restricted access to this item. Please enter item details manually below.';
        } else {
          friendlyMessage = 'This retailer website blocked automated scraping. Please enter item details manually below.';
        }
      } else if (domain === 'URL_NOT_FOUND') {
        friendlyMessage = 'The product page could not be found (404). Please verify the URL or enter details manually.';
      } else if (domain === 'NETWORK_TIMEOUT') {
        friendlyMessage = 'The retailer website took too long to respond or experienced a network error. Please try again or enter details manually.';
      }

      setScrapeError(friendlyMessage);

      // Focus on Item Name input so user can enter details manually
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    } finally {
      setScrapeLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const dataToValidate = {
      ...values,
      isGroupGift: !!values.isGroupGift,
    };

    const parseResult = RegistryItemBaseSchema.safeParse(dataToValidate);
    if (!parseResult.success) {
      setFormError(parseResult.error.issues[0]?.message || 'Invalid form input.');
      return;
    }

    await onSubmit(parseResult.data as Partial<RegistryItem>);
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="form">
      {mode === 'add' && (
        <div className="col-span-1 md:col-span-2 mb-2">
          <FormGroup state={scrapeError ? 'error' : scrapeWarning ? 'warning' : 'default'}>
            <Label>Import from Product URL:</Label>
            <div className="flex gap-2 mt-1">
              <Input
                type="url"
                name="scrapeUrl"
                value={scrapeUrl}
                onChange={e => setScrapeUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1"
                disabled={scrapeLoading}
              />
              <Button
                type="button"
                variant="primary"
                onClick={handleScrape}
                className="flex items-center justify-center"
                disabled={scrapeLoading || !scrapeUrl}
                aria-busy={scrapeLoading}
              >
                {scrapeLoading ? (
                  <>
                    <Icon name="Loader2" className="animate-spin mr-2 h-4 w-4" />
                    Importing...
                  </>
                ) : (
                  'Import'
                )}
              </Button>
            </div>
            {scrapeError && (
              <div className="mt-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm flex flex-col gap-1" data-testid="scrape-error-banner" data-error-domain={scrapeErrorDomain || undefined}>
                <div className="font-semibold flex items-center gap-1.5">
                  <Icon name="AlertTriangle" className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Import Guidance:</span>
                </div>
                <FormMessage>{scrapeError}</FormMessage>
              </div>
            )}
            {scrapeWarning && (
              <div className="mt-2 p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-sm flex flex-col gap-2" data-testid="scrape-warning-banner">
                <div className="font-semibold flex items-center gap-1.5">
                  <Icon name="Info" className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Missing Image Metadata</span>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300">{scrapeWarning}</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleApplyFallbackImage('/images/placeholder.png')}
                    data-testid="btn-apply-placeholder-image"
                  >
                    Use Default Image
                  </Button>
                  {scrapedFaviconUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleApplyFallbackImage(scrapedFaviconUrl)}
                      data-testid="btn-apply-favicon-image"
                    >
                      Use Site Favicon
                    </Button>
                  )}
                </div>
              </div>
            )}
          </FormGroup>
        </div>
      )}
      <FormGroup>
        <Label>Item Name <span className="text-red-500">*</span></Label>
        <Input ref={nameInputRef} type="text" name="name" value={values.name || ''} onChange={handleChange} required aria-required="true" />
      </FormGroup>
      <FormGroup>
        <Label>Category <span className="text-red-500">*</span></Label>
        <Input ref={categoryInputRef} type="text" name="category" value={values.category || ''} onChange={handleChange} required aria-required="true" />
      </FormGroup>
      <FormGroup>
        <Label>Price ($) <span className="text-red-500">*</span></Label>
        <Input ref={priceInputRef} type="number" name="price" value={values.price ?? ''} onChange={handleChange} step="0.01" required aria-required="true" />
      </FormGroup>
      <FormGroup>
        <Label>Quantity <span className="text-red-500">*</span></Label>
        <Input type="number" name="quantity" value={values.quantity ?? 1} onChange={handleChange} required aria-required="true" />
      </FormGroup>
      <FormGroup>
        <div className="flex items-center justify-between mb-1">
          <Label>Image URL:</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleApplyFallbackImage('/images/placeholder.png')}
            className="text-xs text-primary font-normal p-0 h-auto underline hover:bg-transparent"
            data-testid="btn-quick-placeholder"
          >
            Use Default Image
          </Button>
        </div>
        <Input ref={imageUrlInputRef} type="url" name="imageUrl" value={values.imageUrl || (values.image as any)?.url || ''} onChange={handleChange} placeholder="https://..." />
      </FormGroup>
      <FormGroup>
        <Label>Image Alt Text:</Label>
        <Input type="text" name="imageAlt" value={values.imageAlt || (values.image as any)?.altText || ''} onChange={handleChange} placeholder="A descriptive text for screen readers..." disabled={!!(values.imageDecorative || (values.image as any)?.isDecorative)} />
      </FormGroup>
      <FormGroup>
        <div className="flex items-center mt-8">
          <Checkbox name="imageDecorative" checked={values.imageDecorative || (values.image as any)?.isDecorative || false} onChange={handleChange} />
          <Label className="ml-2 font-normal">Decorative (no alt text)</Label>
        </div>
      </FormGroup>
      <FormGroup>
        <Label>Vendor/Product URL:</Label>
        <Input type="url" name="vendorUrl" value={values.vendorUrl || ''} onChange={handleChange} placeholder="https://..." />
      </FormGroup>
      <FormGroup className="col-span-1 md:col-span-2">
        <Label>Description:</Label>
        <Textarea name="description" value={values.description || ''} onChange={handleChange} rows={3} />
      </FormGroup>
      <FormGroup className="col-span-1 md:col-span-2">
        <div className="flex items-center">
          <Checkbox name="isGroupGift" checked={!!values.isGroupGift} onChange={handleChange} />
          <Label className="ml-2 font-normal">Allow Group Gifting?</Label>
        </div>
      </FormGroup>
      <div className="col-span-1 md:col-span-2 mt-4">
        {formError && <FormGroup state="error"><FormMessage>{formError}</FormMessage></FormGroup>}
        <Button type="submit" variant="primary" className="w-full mt-2 flex items-center justify-center" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting && <Icon name="Loader2" className="animate-spin mr-2 h-4 w-4" />}
          {submitLabel || (mode === 'add' ? 'Add Item' : 'Save Changes')}
        </Button>
      </div>
    </form>
  );
};

export default RegistryItemForm;
