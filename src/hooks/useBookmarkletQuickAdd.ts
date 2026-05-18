import { useEffect } from 'react';
import { Category, LinkItem } from '../types';
import { PRIVATE_CATEGORY_ID } from '../utils/constants';

interface UseBookmarkletQuickAddArgs {
  selectedCategory: string;
  categories: Category[];
  isPrivateUnlocked: boolean;
  notify: (msg: string, level?: 'success' | 'warning' | 'error' | 'info') => void;
  setPrefillLink: (link: Partial<LinkItem> | undefined) => void;
  setEditingLink: (link: LinkItem | undefined) => void;
  openAddLinkModal: () => void;
  setPrefillPrivateLink: (link: Partial<LinkItem> | null) => void;
  setEditingPrivateLink: (link: LinkItem | null) => void;
  openPrivateAddModal: () => void;
}

/**
 * 处理书签小工具传入的 `?add_url=&add_title=`：
 *   - 私有视图未解锁 → 提示并放弃
 *   - 私有视图已解锁 → 走隐私新增模态
 *   - 公开视图 → 走普通新增模态，使用当前分类或默认 "common"
 *
 * Hook 只在挂载时跑一次 (useEffect with stable refs)。
 */
export function useBookmarkletQuickAdd(args: UseBookmarkletQuickAddArgs): void {
  const {
    selectedCategory,
    categories,
    isPrivateUnlocked,
    notify,
    setPrefillLink,
    setEditingLink,
    openAddLinkModal,
    setPrefillPrivateLink,
    setEditingPrivateLink,
    openPrivateAddModal,
  } = args;

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (!addUrl) return;
    const addTitle = urlParams.get('add_title') || '';
    window.history.replaceState({}, '', window.location.pathname);

    if (selectedCategory === PRIVATE_CATEGORY_ID) {
      if (!isPrivateUnlocked) {
        notify('请先解锁隐私分组', 'warning');
        return;
      }
      setPrefillPrivateLink({
        title: addTitle,
        url: addUrl,
        categoryId: PRIVATE_CATEGORY_ID,
      });
      setEditingPrivateLink(null);
      openPrivateAddModal();
      return;
    }

    const fallbackCategoryId =
      selectedCategory !== 'all'
        ? selectedCategory
        : categories.find((c) => c.id === 'common')?.id || categories[0]?.id || 'common';
    setPrefillLink({
      title: addTitle,
      url: addUrl,
      categoryId: fallbackCategoryId,
    });
    setEditingLink(undefined);
    openAddLinkModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在挂载时运行一次
  }, []);
}
