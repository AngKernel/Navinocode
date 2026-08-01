import { useEffect, useState } from 'react';

export const GITHUB_REPOSITORY_URL = 'https://github.com/AngKernel/Navinocode';
const GITHUB_REPOSITORY_API_URL = 'https://api.github.com/repos/AngKernel/Navinocode';
const LEGACY_REPOSITORY_URLS = new Set([
  'https://github.com/y-shi23/Navinocode',
  'https://github.com/XuYouo/Navinocode',
]);

const updateRepositoryLinks = () => {
  document.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const isSourceLink = link.textContent?.trim().includes('查看项目源码');
    if (isSourceLink || LEGACY_REPOSITORY_URLS.has(href.replace(/\/$/, ''))) {
      link.href = GITHUB_REPOSITORY_URL;
    }
  });
};

export const useGitHubStars = () => {
  const [stars, setStars] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStars = async () => {
      try {
        const response = await fetch(GITHUB_REPOSITORY_API_URL);
        if (!response.ok) {
          throw new Error('Failed to fetch GitHub stars');
        }
        const data = await response.json();
        setStars(data.stargazers_count);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStars();
  }, []);

  useEffect(() => {
    updateRepositoryLinks();
    const observer = new MutationObserver(updateRepositoryLinks);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return { stars, loading, error };
};
