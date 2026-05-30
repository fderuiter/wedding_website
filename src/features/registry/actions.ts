'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';
import ogs from 'open-graph-scraper';
import * as cheerio from 'cheerio';
import { isPrivateUrl } from '@/utils/ssrf';

export async function scrapeRegistryItemUrl(url: string) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    throw new Error('Unauthorized');
  }
  
  if (!url || typeof url !== 'string') {
    throw new Error('URL is required and must be a string');
  }

  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (await isPrivateUrl(url)) {
    throw new Error('Invalid URL: Private or restricted address');
  }

  const ogsOptions = {
    url,
    fetchOptions: {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
      },
    },
  };

  const { error, result } = await ogs(ogsOptions);
  if (error) {
    throw new Error('Failed to scrape product info');
  }

  let image = result.ogImage && result.ogImage.length > 0 ? result.ogImage[0].url : '';
  if (!image && result.twitterImage && result.twitterImage.length > 0) {
    image = result.twitterImage[0].url;
  }

  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;
  const isAmazonDomain = (
    hostname === 'amazon.com' ||
    (hostname.endsWith('.amazon.com'))
  );
  if (!image && isAmazonDomain) {
    try {
      const response = await fetch(url);
      const html = await response.text();
      const $ = cheerio.load(html);

      const imageElement = $('#imgTagWrapperId img');

      if (imageElement.length > 0) {
        const imageSrc = imageElement.attr('src');
        if (imageSrc) {
          image = imageSrc;
        }
      }
    } catch (e) {
      console.error('Cheerio fallback for Amazon failed:', e);
    }
  }

  return {
    name: result.ogTitle || '',
    description: result.ogDescription || '',
    image: image,
    vendorUrl: url,
    quantity: 1,
  };
}

export async function deleteRegistryItem(itemId: string) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    throw new Error('Unauthorized');
  }

  await prisma.registryItem.delete({
    where: { id: itemId },
  });

  revalidatePath('/registry');
}

export async function updateRegistryItem(itemId: string, data: Partial<any>) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    throw new Error('Unauthorized');
  }

  await prisma.registryItem.update({
    where: { id: itemId },
    data,
  });

  revalidatePath('/registry');
  revalidatePath('/admin/dashboard');
}

export async function addRegistryItem(data: any) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    throw new Error('Unauthorized');
  }

  const newItem = await prisma.registryItem.create({
    data,
  });

  revalidatePath('/registry');
  revalidatePath('/admin/dashboard');
  return newItem;
}
export async function contributeToRegistryItem(itemId: string, purchaserName: string, amount: number) {
  const item = await prisma.registryItem.findUnique({
    where: { id: itemId },
    include: { contributors: true },
  });

  if (!item) {
    throw new Error('Item not found');
  }

  if (item.isGroupGift) {
    const newAmount = item.amountContributed + amount;
    const purchased = newAmount >= item.price;
    await prisma.registryItem.update({
      where: { id: itemId },
      data: {
        amountContributed: Math.min(item.price, newAmount),
        purchased,
        contributors: {
          create: {
            name: purchaserName,
            amount: amount,
            date: new Date(),
          },
        },
      },
    });
  } else {
    await prisma.registryItem.update({
      where: { id: itemId },
      data: {
        purchased: true,
        purchaserName,
      },
    });
  }

  revalidatePath('/registry');
}
