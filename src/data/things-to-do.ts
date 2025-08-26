export interface Attraction {
  name: string;
  description: string;
  image?: string;
  category: 'food' | 'coffee' | 'park' | 'museum' | 'hotel' | 'venue';
  website: string;
  directions: string;
  latitude: number;
  longitude: number;
}

export const attractions: Attraction[] = [
  {
    name: 'Mayo Clinic Campus',
    description: 'Explore the world-renowned Mayo Clinic campus and its stunning architecture. The campus is home to a large collection of art.',
    category: 'museum',
    image: 'https://assets.mayoclinic.org/content/dam/media/global/images/2024/09/24/roch-campus-720x400-3col.jpg',
    website: 'https://www.mayoclinic.org/patient-visitor-guide/minnesota/becoming-a-patient/campus-tours',
    directions: 'https://www.google.com/maps/search/?api=1&query=Mayo+Clinic+Rochester+MN',
    latitude: 44.0232,
    longitude: -92.4679
  },
  {
    name: 'Plummer House',
    description: 'A historic English Tudor mansion with beautiful gardens, the former home of Dr. Henry S. Plummer.',
    category: 'museum',
    image: 'https://www.exploreminnesota.com/sites/default/files/styles/listing_slideshow/public/listing_images/0b0ee28e5891387098fe39e4a057a315e6b553b1_37.jpg.jpg?itok=j9QHJ0kJ',
    website: 'https://www.rochestermn.gov/govenrnment/departments/parks-and-recreation/rentals-permits/plummer-house',
    directions: 'https://www.google.com/maps/search/?api=1&query=Plummer+House+Rochester+MN',
    latitude: 44.0019,
    longitude: -92.4800
  },
  {
    name: 'Silver Lake Park',
    description: 'A large urban park with a lake, walking and biking trails, a skate park, and a swimming pool.',
    category: 'park',
    image: 'https://static.where-e.com/United_States/Silver-Lake-Park_335ca2555e3c51e7dfe233bc5442c300.jpg',
    website: 'https://www.rochestermn.gov/government/departments/parks-and-recreation/parks-trails/silver-lake-park',
    directions: 'https://www.google.com/maps/search/?api=1&query=Silver+Lake+Park+Rochester+MN',
    latitude: 44.0321,
    longitude: -92.4647
  },
  {
    name: 'Forager Brewery',
    description: 'A local brewery known for its unique and creative beers, as well as a food menu featuring locally sourced ingredients.',
    category: 'food',
    image: 'https://static.wixstatic.com/media/a264f4_2fbd002ed70b4011b828f0bcf1c2aa99~mv2.jpg',
    website: 'https://www.foragerbrewery.com/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Forager+Brewery+Rochester+MN',
    latitude: 44.0189,
    longitude: -92.4881
  },
  {
    name: 'Fiddlehead Coffee Co.',
    description: 'A popular local coffee shop with multiple locations, serving high-quality coffee and pastries.',
    category: 'coffee',
    image: 'https://img.ctykit.com/cdn/mn-rochester/images/tr:w-900/425787538-18415394977042832-7869996539200696849-n.jpg',
    website: 'https://fiddleheadcoffee.co/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Fiddlehead+Coffee+Co+Rochester+MN',
    latitude: 44.0238,
    longitude: -92.4674
  },
  {
    name: 'Quarry Hill Nature Center',
    description: 'A nature center with hiking trails, a fishing pond, and an indoor exhibit with live animals.',
    category: 'park',
    image: 'https://assets.simpleviewinc.com/simpleview/image/upload/c_limit,q_75,w_1200/v1/crm/rochestermn/Quarry-Hill-5-by-AB-PHOTOGRAPHY.US-6df0bc7a5056a36_6df0be10-5056-a36a-0916f7301f0fa335.jpg',
    website: 'https://www.qhnc.org/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Quarry+Hill+Nature+Center+Rochester+MN',
    latitude: 44.0335,
    longitude: -92.4228
  },
  {
    name: 'The Kahler Grand Hotel',
    description: 'A historic hotel located in the heart of downtown Rochester, connected to the Mayo Clinic.',
    category: 'hotel',
    image: 'https://images.trvl-media.com/lodging/1000000/30000/25600/25516/a12994da.jpg',
    website: 'https://www.hyatt.com/en-US/hotel/minnesota/the-kahler-grand-hotel/rstkh',
    directions: 'https://www.google.com/maps/search/?api=1&query=The+Kahler+Grand+Hotel',
    latitude: 44.0221,
    longitude: -92.4658
  },
  {
    name: 'Hilton Rochester Mayo Clinic Area',
    description: 'A modern hotel offering upscale accommodations and amenities, with skyway access to the Mayo Clinic.',
    category: 'hotel',
    image: 'https://images.trvl-media.com/lodging/28000000/27430000/27426400/27426319/1213b471.jpg',
    website: 'https://www.hilton.com/en/hotels/rstmnhh-hilton-rochester-mayo-clinic-area/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Hilton+Rochester+Mayo+Clinic+Area',
    latitude: 44.0240,
    longitude: -92.4648
  },
  {
    name: 'Mayo Civic Center',
    description: 'A large convention and event center that hosts a variety of concerts, trade shows, and sporting events.',
    category: 'venue',
    image: 'https://assets.simpleviewinc.com/simpleview/image/upload/v1/clients/rochestermn/Credit_Time_Into_Pixels_Photography_2_d138e5cb-718c-4738-b2e3-0070830a7e0b.jpg',
    website: 'https://www.mayociviccenter.com/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Mayo+Civic+Center',
    latitude: 44.0236,
    longitude: -92.4608
  },
  {
    name: 'Terza Ristorante',
    description: 'An Italian restaurant offering a modern take on classic dishes, with an extensive wine list.',
    category: 'food',
    image: 'https://static.where-e.com/United_States/Terza_361ad5e1121adcad5c02bcf824ad9f64.jpg',
    website: 'https://www.terzarochester.com/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Terza+Ristorante+Rochester+MN',
    latitude: 44.0232,
    longitude: -92.4660
  },
  {
    name: 'Soldiers Field Veterans Memorial',
    description: 'A memorial honoring veterans from southeastern Minnesota, located in a large park with a golf course and swimming pool.',
    category: 'park',
    image: 'https://upload.wikimedia.org/wikipedia/commons/e/e1/Soldiers_Field_Veterans_Memorial,_Rochester_Minnesota.jpg',
    website: 'https://www.soldiersfieldmemorial.org/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Soldiers+Field+Veterans+Memorial',
    latitude: 44.0135,
    longitude: -92.4695
  },
  {
    name: 'Cafe Steam',
    description: 'A trendy coffee shop with a vibrant atmosphere, serving a variety of coffee drinks and light snacks.',
    category: 'coffee',
    image: 'https://img.ctykit.com/cdn/mn-rochester/images/tr:w-900/425787538-18415394977042832-7869996539200696849-n.jpg',
    website: 'https://www.steam.coffee/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Cafe+Steam+Rochester+MN',
    latitude: 44.0233,
    longitude: -92.4671
  },
  {
    name: 'Rochester Art Center',
    description: 'A contemporary art museum featuring works by local, regional, and national artists.',
    category: 'museum',
    image: 'https://static.wixstatic.com/media/96bde7_4769f16c41204eaab7a72e59b9af57b0~mv2.jpg',
    website: 'https://rochesterartcenter.org/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Rochester+Art+Center',
    latitude: 44.0236,
    longitude: -92.4601
  }
];
