export interface Attraction {
  name: string;
  description: string;
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
    website: 'https://www.mayoclinic.org/patient-visitor-guide/minnesota/becoming-a-patient/campus-tours',
    directions: 'https://www.google.com/maps/search/?api=1&query=Mayo+Clinic+Rochester+MN',
    latitude: 44.0232,
    longitude: -92.4679
  },
  {
    name: 'Plummer House',
    description: 'A historic English Tudor mansion with beautiful gardens, the former home of Dr. Henry S. Plummer.',
    category: 'museum',
    website: 'https://www.rochestermn.gov/govenrnment/departments/parks-and-recreation/rentals-permits/plummer-house',
    directions: 'https://www.google.com/maps/search/?api=1&query=Plummer+House+Rochester+MN',
    latitude: 44.0019,
    longitude: -92.4800
  },
  {
    name: 'Silver Lake Park',
    description: 'A large urban park with a lake, walking and biking trails, a skate park, and a swimming pool.',
    category: 'park',
    website: 'https://www.rochestermn.gov/government/departments/parks-and-recreation/parks-trails/silver-lake-park',
    directions: 'https://www.google.com/maps/search/?api=1&query=Silver+Lake+Park+Rochester+MN',
    latitude: 44.0321,
    longitude: -92.4647
  },
  {
    name: 'Forager Brewery',
    description: 'A local brewery known for its unique and creative beers, as well as a food menu featuring locally sourced ingredients.',
    category: 'food',
    website: 'https://www.foragerbrewery.com/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Forager+Brewery+Rochester+MN',
    latitude: 44.0189,
    longitude: -92.4881
  },
  {
    name: 'Fiddlehead Coffee Co.',
    description: 'A popular local coffee shop with multiple locations, serving high-quality coffee and pastries.',
    category: 'coffee',
    website: 'https://fiddleheadcoffee.co/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Fiddlehead+Coffee+Co+Rochester+MN',
    latitude: 44.0238,
    longitude: -92.4674
  },
  {
    name: 'Quarry Hill Nature Center',
    description: 'A nature center with hiking trails, a fishing pond, and an indoor exhibit with live animals.',
    category: 'park',
    website: 'https://www.qhnc.org/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Quarry+Hill+Nature+Center+Rochester+MN',
    latitude: 44.0335,
    longitude: -92.4228
  },
  {
    name: 'The Kahler Grand Hotel',
    description: 'A historic hotel located in the heart of downtown Rochester, connected to the Mayo Clinic.',
    category: 'hotel',
    website: 'https://www.hyatt.com/en-US/hotel/minnesota/the-kahler-grand-hotel/rstkh',
    directions: 'https://www.google.com/maps/search/?api=1&query=The+Kahler+Grand+Hotel',
    latitude: 44.0221,
    longitude: -92.4658
  },
  {
    name: 'Hilton Rochester Mayo Clinic Area',
    description: 'A modern hotel offering upscale accommodations and amenities, with skyway access to the Mayo Clinic.',
    category: 'hotel',
    website: 'https://www.hilton.com/en/hotels/rstmnhh-hilton-rochester-mayo-clinic-area/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Hilton+Rochester+Mayo+Clinic+Area',
    latitude: 44.0240,
    longitude: -92.4648
  },
  {
    name: 'Mayo Civic Center',
    description: 'A large convention and event center that hosts a variety of concerts, trade shows, and sporting events.',
    category: 'venue',
    website: 'https://www.mayociviccenter.com/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Mayo+Civic+Center',
    latitude: 44.0236,
    longitude: -92.4608
  },
  {
    name: 'Terza Ristorante',
    description: 'An Italian restaurant offering a modern take on classic dishes, with an extensive wine list.',
    category: 'food',
    website: 'https://www.terzarochester.com/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Terza+Ristorante+Rochester+MN',
    latitude: 44.0232,
    longitude: -92.4660
  },
  {
    name: 'Soldiers Field Veterans Memorial',
    description: 'A memorial honoring veterans from southeastern Minnesota, located in a large park with a golf course and swimming pool.',
    category: 'park',
    website: 'https://www.soldiersfieldmemorial.org/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Soldiers+Field+Veterans+Memorial',
    latitude: 44.0135,
    longitude: -92.4695
  },
  {
    name: 'Cafe Steam',
    description: 'A trendy coffee shop with a vibrant atmosphere, serving a variety of coffee drinks and light snacks.',
    category: 'coffee',
    website: 'https://www.steam.coffee/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Cafe+Steam+Rochester+MN',
    latitude: 44.0233,
    longitude: -92.4671
  },
  {
    name: 'Rochester Art Center',
    description: 'A contemporary art museum featuring works by local, regional, and national artists.',
    category: 'museum',
    website: 'https://rochesterartcenter.org/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Rochester+Art+Center',
    latitude: 44.0236,
    longitude: -92.4601
  }
];
