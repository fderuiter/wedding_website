import { MetadataRoute } from 'next';

/**
 * @function manifest
 * @description Generates the manifest.json file for the application.
 * This file provides metadata used when the web app is installed on a user's device.
 *
 * @returns {MetadataRoute.Manifest} The manifest configuration.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Abbigayle & Frederick's Wedding",
    short_name: 'Abbi & Fred',
    description: "Abbigayle & Frederick's Wedding Website",
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  };
}
