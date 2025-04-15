import React from 'react';

const ProjectInfo = () => {
  return (
    <div className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-12">About This Project</h1>
      <div className="prose lg:prose-lg mx-auto">
        <p>
          This website was created to celebrate the wedding of Abbigayle Schultz and Frederick de Ruiter. It includes features like a registry, event details, and more.
        </p>
        <p>
          The project is built using modern web technologies. Below is the core tech stack that powers this site:
        </p>
        <ul>
          <li><strong>Framework:</strong> Next.js (App Router)</li>
          <li><strong>Language:</strong> TypeScript & React</li>
          <li><strong>Styling:</strong> Tailwind CSS</li>
          <li><strong>3D Animation:</strong> React Three Fiber, Drei</li>
          <li><strong>Client-side Search:</strong> Fuse.js</li>
          <li><strong>State Management:</strong> React Hooks</li>
        </ul>
        <p>
          For more information, visit the <a href="https://github.com/FrederickdeRuiter" target="_blank" rel="noopener noreferrer">GitHub repository</a>.
        </p>
      </div>
    </div>
  );
};

export default ProjectInfo;
