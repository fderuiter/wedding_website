import React from 'react';
import { Link } from 'react-router-dom';

const Navbar = () => {
    const navLinks = [
        { path: '/', label: 'Dom' },
        { path: '/photos', label: 'Zdjęcia' },
        { path: '/archive', label: 'Archiwum' },
    ];

    const homeNavLinks = [
        { path: '/details', label: 'Szczegóły' },
        { path: '/travel', label: 'Podróż' },
        { path: '/faq', label: 'FAQ' },
    ];

    return (
        <nav>
            <div className="brand">A & M</div>
            <ul>
                {navLinks.map(link => (
                    <li key={link.path}><Link to={link.path}>{link.label}</Link></li>
                ))}
            </ul>
            <ul>
                {homeNavLinks.map(link => (
                    <li key={link.path}><Link to={link.path}>{link.label}</Link></li>
                ))}
            </ul>
            <div className="admin-mode">Tryb Administratora</div>
            <button className="logout">Wyloguj</button>
            <button className="menu-toggle" aria-label="Zamknij menu główne" aria-expanded="false">Otwórz menu główne</button>
        </nav>
    );
};

export default Navbar;