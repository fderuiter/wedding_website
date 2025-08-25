export interface Attraction {
  name: string;
  description: string;
  category: 'food' | 'coffee' | 'park' | 'museum';
  website: string;
  directions: string;
}

export const attractions: Attraction[] = [
  {
    name: 'Mayo Clinic Campus Tour',
    description: 'Explore the world-renowned Mayo Clinic campus and its stunning architecture. The campus is home to a large collection of art.',
    category: 'museum',
    website: 'https://www.mayoclinic.org/patient-visitor-guide/minnesota/becoming-a-patient/campus-tours',
    directions: 'https://www.google.com/maps/search/?api=1&query=Mayo+Clinic+Rochester+MN'
  },
  {
    name: 'Plummer House',
    description: 'A historic English Tudor mansion with beautiful gardens, the former home of Dr. Henry S. Plummer.',
    category: 'museum',
    website: 'https://www.rochestermn.gov/govenrnment/departments/parks-and-recreation/rentals-permits/plummer-house',
    directions: 'https://www.google.com/maps/search/?api=1&query=Plummer+House+Rochester+MN'
  },
  {
    name: 'Silver Lake Park',
    description: 'A large urban park with a lake, walking and biking trails, a skate park, and a swimming pool.',
    category: 'park',
    website: 'https://www.rochestermn.gov/government/departments/parks-and-recreation/parks-trails/silver-lake-park',
    directions: 'https://www.google.com/maps/search/?api=1&query=Silver+Lake+Park+Rochester+MN'
  },
  {
    name: 'Forager Brewery',
    description: 'A local brewery known for its unique and creative beers, as well as a food menu featuring locally sourced ingredients.',
    category: 'food',
    website: 'https://www.foragerbrewery.com/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Forager+Brewery+Rochester+MN'
  },
  {
    name: 'Fiddlehead Coffee Co.',
    description: 'A popular local coffee shop with multiple locations, serving high-quality coffee and pastries.',
    category: 'coffee',
    website: 'https://fiddleheadcoffee.co/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Fiddlehead+Coffee+Co+Rochester+MN'
  },
  {
    name: 'Quarry Hill Nature Center',
    description: 'A nature center with hiking trails, a fishing pond, and an indoor exhibit with live animals.',
    category: 'park',
    website: 'https://www.qhnc.org/',
    directions: 'https://www.google.com/maps/search/?api=1&query=Quarry+Hill+Nature+Center+Rochester+MN'
  }
];
