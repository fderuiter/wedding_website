import React from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { Camera } from 'lucide-react';
import Script from 'next/script';

export const metadata: Metadata = {
  title: "Photos",
  alternates: {
    canonical: '/photos',
  },
};

export default function PhotosPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <Script src="https://cdn.jsdelivr.net/npm/publicalbum@latest/embed-ui.min.js" async />
      <h1 className="text-4xl font-bold text-center mb-8 text-rose-700 dark:text-rose-400">
        Our Wedding Photos
      </h1>
      <p className="text-center text-lg mb-12">
        Here is a small selection of photos from our special day. You can view the full album on Google Photos.
      </p>
      <div className="pa-gallery-player-widget" style={{width: "100%", height: "480px", display: "none"}}
        data-link="https://photos.google.com/share/AF1QipMnse1_Xznr2_loPvSR-McR3niH6WtH8lURPwInB0bvBUzrEcZj2kyhtq4ptCArwg?key=MHdQcFk2aUpwYXJnNHNnTllPRmZ1c0JxbEVHQWpn"
        data-title="Wedding Pics (Good ones) · Friday, Oct 10 📸"
        data-description="Shared album · Tap to view!">
        <object data="https://lh3.googleusercontent.com/pw/AP1GczNPp0Rk6pvvMtymS3RUx7F6cAyOkFaovF20N5_FkaDupk3QkgjNWfTiMxZbgtnyO-Ny0tH3JPkT6Vld35Pg8xFq1AAcZcxnHdTQ3DfHKsNLKpA59mEw=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczODgnqdtUHWdCR_PDvAcDDm-RlYv0HE_oJtRCDTKF9nCREFVhZRl_020THVphEdxLAjgYfUdz0KYgCBw1sqmaF1GC7RBh0u3CZmUgBtwD7Z-bEkPm5A=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczPzyrWDTfT2ofwHN6_wBKO8luOfDy2xpvoQNOiOw1cSoO1yUaLPW3mPbTBCUFGoCqI1hB0udanXyfM55PXEMYtmkkTSqQhoUVqQnBmz5qnYUYU_NnhB=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczPeRWHDkvouhncUEhhHHOAo5u-uPM3S7a6EXZTH8qO3BsG2Yo-f_y7XpK8TqALxpm4_OeA14gzpGOiiTBj6b2JP27xNQ39P159CbZn8BML4cRrcrSYw=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczP2x9gDf6MmKoAhEBg3cUOCg42Mk-l0uPPOuhBp77b-KrlgnPN_1yqUT2F_tc3ffa4BIvQBVcONVuV3_AXp_1T6l0PugHstYE0IDKKqikjy16ZNpiu7=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczMfm0jygX3akWEN6XZXxKi72qPDtykQtA30g2hU3aWsP_bqtDMSuJAfDJUUABiO6XSrpoaOATGSw1HN6ZX91dOiXvha6GGqYkakGL24hgUXUSek_EHM=w1920-h11080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczPkTva_2XGwF8d1eVuuWinGtR_bfqpJHHhDEshfYUKDcwzXn0-egIBsf8TbYbmAcuowf-p72HDytwpK3ORDcD5AOtbXG7Lup_wS2yZYSDzqXqrH3iNc=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczNUft5lyjyIoYX99dNeQPQ8zigcrsu5Xf95bxH3i0Z_7ZzKjvBRnk_4cTe3uQWUZjhl3v5CDMD0u07JQBG_t6drLdZR5kzVVChZlugJX_d_gAd1Y5Bz=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczPAb-RVFteLsC0rmMLph7OmF-22p7srgSKCYCCp_x7STlBmGhIj-0ucp7SZy8olIyMlaA9tWYK5z9hHT-z6KNVc1Yb-s7cKqa3AYmGd9YxTB91hQJTw=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczPPZHlCTkGM1yZR63AVtTVhTDjWagWvSeCoh3cmJi8d3hZDhk6h5G8IiK_9yBLyF9IS8OE_dCcLPAZdk5hFmLniUk97_ODB3OWIB8Gibs-KwsyktxtN=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczO-H7ch_7xST7jlftlKYRsQTNG46MSbuIrMLDHNY8BlUBJ9zpo496U59dCEWXd2c9Kimb0ZU8hQZYmUJmRYIT7deRF2Wl4uvNzqB47TRMsKFlFm_4uA=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczNMI2xVAzbQx1Eu0IzVn3dwAHAjZm6sqrQ-4tAlkvTaNHzjxWbKEYfWOgCq9y7Gr9RMjdFAYdNMDhtz-vPkwTkEPRo2CBWtoJT4NZnpBmKRSiPuDYDE=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczOOO4SaHAKCF4i4rHj35WTLX0PZgxipVR5jkvXryv-bEFVnDwwux1E9vxh_tqfxi1Pta-WBNXMnPH3CpF_iAowxVQOwlEEamaTT5mjqt2zNht9Z9hPs=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczN1MHrsHHPmCj9hHjtOY--ncNSNhUWJM00PFszgfS8KZQ5d4eeIN2rpgRLj_jIQ9w1ctCixA9c9lDntx0slIbkEjjGCmEGZCtHlPhQLzyqL50_uolRq=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczO9WEPEVNJaHIdBRO23QrdPcNiHhxjZQEyFX6BpzjPfC93m4Yo3iH6hDxdCavtGHpJz8AkxHrZi-bhlbmOEpfcbHDPvZBFtF3Magrjjy4VI-H8LGInP=w1920-h1080"></object>
        <object data="https://lh3.googleusercontent.com/pw/AP1GczNRCQSC2TVH8_X2AzVvddlrHTfto9aLCYtVUVT1VpLItwZSRwAsT7bhag2TeCy4RGxRDjQ3SzKfgLuB4NUdDkOcPB5OYrjhaVLAbwzdspw_EoTL5HdO=w1920-h1080"></object>
      </div>
      <div className="flex justify-center mt-12">
        <Link href="https://photos.app.goo.gl/v1Rw81HSoyLVNEDx5"
          target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-700 to-amber-500 px-8 py-3 text-white shadow-lg transition hover:shadow-xl">
            View Full Album
            <Camera className="w-5 h-5" />
        </Link>
      </div>
    </main>
  );
}
