import React, { PureComponent } from 'react';
import classnames from 'classnames';
import './burgericon.scss';
import { PropTypes } from 'prop-types';

class BurgerIconMenu extends PureComponent {
	state = {
		open: false
	};

	onClickHandle = () => {
		this.setState({ open: !this.state.open }, () =>
			this.props.toggleOpenSidebar()
		);
	};

	render() {
		const burgerClass = classnames({ open: this.state.open });
		return (
			<div
				id="burger-icon"
				onClick={this.onClickHandle}
				className={burgerClass}
			>
				<span />
			</div>
		);
	}
}

BurgerIconMenu.propTypes = {
	/** toggle open right side bar */
	toggleOpenSidebar: PropTypes.func
};

export default BurgerIconMenu;
